// signal-translator
// Phase 3 — Multilingual ground truth.
//
// For each signal where translation_status IS NULL:
//  - Detect source language from title+summary.
//  - If English (or sufficiently English), mark not_needed and copy originals.
//  - Otherwise translate title+summary to English via Lovable AI Gateway,
//    keeping originals untouched for audit.
//
// Idempotent. Logs to automation_logs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const MODEL = "google/gemini-3-flash-preview";

const BATCH = 60;

// Heuristic language detection — fast and runtime-cheap. AI fallback is used
// only when translation is needed for non-Latin scripts so we keep cost low.
function detectLanguage(text: string): string {
  if (!text) return "und";
  const t = text.slice(0, 800);
  // script ranges first
  if (/[\u0590-\u05FF]/.test(t)) return "he";
  if (/[\u0600-\u06FF]/.test(t)) return "ar";
  if (/[\u0900-\u097F]/.test(t)) return "hi";
  if (/[\u3040-\u30FF]/.test(t)) return "ja";
  if (/[\u3400-\u9FFF]/.test(t)) return "zh";
  if (/[\uAC00-\uD7AF]/.test(t)) return "ko";
  if (/[\u0400-\u04FF]/.test(t)) return "ru";
  if (/[\u0E00-\u0E7F]/.test(t)) return "th";

  // Latin-script heuristics by stopword density
  const lower = ` ${t.toLowerCase().replace(/[^a-záéíóúñçàèìòùâêîôûäëïöüãõ' ]+/g, " ")} `;
  const SCORES: Record<string, string[]> = {
    en: [" the ", " and ", " of ", " to ", " in ", " for ", " on ", " with "],
    es: [" el ", " la ", " los ", " de ", " que ", " en ", " por ", " del "],
    pt: [" o ", " os ", " do ", " da ", " com ", " para ", " que ", " uma "],
    fr: [" le ", " la ", " les ", " des ", " une ", " que ", " dans ", " pour "],
    de: [" der ", " die ", " das ", " und ", " mit ", " ist ", " nicht "],
    it: [" il ", " la ", " che ", " di ", " un ", " una ", " per ", " con "],
    id: [" dan ", " yang ", " untuk ", " dengan ", " adalah ", " tidak "],
    sw: [" na ", " ya ", " kwa ", " katika ", " wa ", " kuwa ", " ni "],
  };
  let bestLang = "en", bestScore = 0;
  for (const [lang, words] of Object.entries(SCORES)) {
    let s = 0;
    for (const w of words) if (lower.includes(w)) s++;
    if (s > bestScore) { bestScore = s; bestLang = lang; }
  }
  return bestScore >= 2 ? bestLang : "und";
}

async function translate(title: string, summary: string | null): Promise<{ title: string; summary: string | null } | null> {
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: "You translate news headlines and summaries into clear, neutral English. Preserve named entities and numbers exactly. Return ONLY the JSON object requested, no commentary." },
      { role: "user", content: `Translate to English. Return JSON {"title": "...", "summary": "..."}.\n\nTITLE: ${title}\n\nSUMMARY: ${summary || ""}` },
    ],
    response_format: { type: "json_object" },
  };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429 || res.status === 402) {
    console.error("translator gateway", res.status);
    return null;
  }
  if (!res.ok) {
    console.error("translator gateway error", res.status, await res.text());
    return null;
  }
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return { title: String(parsed.title || title), summary: parsed.summary ? String(parsed.summary) : (summary || null) };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let processed = 0, translated = 0, notNeeded = 0, failed = 0;
  try {
    const { data: pending, error } = await supa
      .from("global_signals")
      .select("id,title,summary,canonical_source_name,primary_source")
      .is("translation_status", null)
      .order("first_detected_at", { ascending: false })
      .limit(BATCH);
    if (error) throw error;

    for (const sig of pending || []) {
      processed++;
      const text = `${sig.title || ""}\n${sig.summary || ""}`;
      const lang = detectLanguage(text);
      // copy originals always
      const baseUpdate: any = {
        source_language: lang,
        original_title: sig.title,
        original_summary: sig.summary,
      };
      if (lang === "en" || lang === "und") {
        const { error: e1 } = await supa.from("global_signals").update({
          ...baseUpdate,
          translation_status: "not_needed",
          translated_at: new Date().toISOString(),
        }).eq("id", sig.id);
        if (e1) throw e1;
        notNeeded++;
        continue;
      }
      const out = await translate(sig.title || "", sig.summary);
      if (!out) {
        const { error: e2 } = await supa.from("global_signals").update({
          ...baseUpdate,
          translation_status: "failed",
        }).eq("id", sig.id);
        if (e2) throw e2;
        failed++;
        continue;
      }
      const { error: e3 } = await supa.from("global_signals").update({
        ...baseUpdate,
        translated_title: out.title,
        translated_summary: out.summary,
        translation_status: "translated",
        translation_model: MODEL,
        translated_at: new Date().toISOString(),
      }).eq("id", sig.id);
      if (e3) throw e3;
      translated++;
    }

    await supa.from("automation_logs").insert({
      job_name: "signal-translator",
      status: "success",
      message: `processed=${processed} translated=${translated} not_needed=${notNeeded} failed=${failed} in ${Date.now() - startedAt}ms`,
    });
    return new Response(JSON.stringify({ processed, translated, not_needed: notNeeded, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("signal-translator error:", msg);
    await supa.from("automation_logs").insert({
      job_name: "signal-translator", status: "error", message: msg.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
