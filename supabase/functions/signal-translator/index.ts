// signal-translator
// Phase 3.1 — Translation execution only.
//
// Language detection + tiering + spend gating now live in `language-router`.
// This function only acts on rows with translation_status = 'pending':
//  - Calls Lovable AI Gateway to translate title + summary into English.
//  - Preserves original_title/original_summary if not already set.
//  - Marks 'translated' on success, 'failed' on error.
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

const BATCH = 50;

async function translate(title: string, summary: string | null): Promise<{ title: string; summary: string | null } | null> {
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: "You translate news headlines and summaries into clear, neutral English. Preserve named entities and numbers exactly. Return ONLY the JSON object requested." },
      { role: "user", content: `Translate to English. Return JSON {"title":"...","summary":"..."}.\n\nTITLE: ${title}\n\nSUMMARY: ${summary || ""}` },
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
  let processed = 0, translated = 0, failed = 0;
  try {
    const { data: pending, error } = await supa
      .from("global_signals")
      .select("id,title,summary,original_title,original_summary,source_language")
      .eq("translation_status", "pending")
      .order("first_detected_at", { ascending: false })
      .limit(BATCH);
    if (error) throw error;

    for (const sig of pending || []) {
      processed++;
      const baseUpdate: any = {
        original_title: sig.original_title ?? sig.title,
        original_summary: sig.original_summary ?? sig.summary,
      };
      const out = await translate(sig.title || "", sig.summary);
      if (!out) {
        await supa.from("global_signals").update({
          ...baseUpdate, translation_status: "failed",
        }).eq("id", sig.id);
        failed++;
        continue;
      }
      await supa.from("global_signals").update({
        ...baseUpdate,
        translated_title: out.title,
        translated_summary: out.summary,
        translation_status: "translated",
        translation_model: MODEL,
        translated_at: new Date().toISOString(),
        last_pipeline_stage: "translated",
      }).eq("id", sig.id);
      translated++;
    }

    await supa.from("automation_logs").insert({
      job_name: "signal-translator",
      status: "success",
      message: `processed=${processed} translated=${translated} failed=${failed} in ${Date.now() - startedAt}ms`,
    });
    return new Response(JSON.stringify({ processed, translated, failed }), {
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
