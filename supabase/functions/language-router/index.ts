// language-router
// Phase 3.1 — Tiered language detection + translation spending guard.
//
// Tier 1 (high-signal):  en, ar, fr, es, pt, ru, zh, hi, id, sw, tr, fa, ur, bn, ha, am, uk
// Tier 2 (common):       de, it, nl, pl, vi, ja, ko, th, he, el, ro, hu, cs, sv, no, da, fi, ms, fil, ne, my, kk, az, uz
// Tier 3 (low-resource): everything else identifiable
// Unknown:               script could not be classified
//
// Detection cascade:
//  1) Deterministic Unicode script ranges → fills script_detected
//  2) Latin-script stopword heuristic for ~20 common langs (high precision when ≥2 hits)
//  3) Lovable AI classification fallback ONLY if script is Latin AND heuristic was uncertain
//
// Spending guard (sets translation_status):
//  - 'not_needed'              → English source
//  - 'pending'                 → Tier 1/2 AND meets relevance bar
//  - 'deferred_low_relevance'  → Tier 1/2 but low signal value
//  - 'deferred_low_resource'   → Tier 3 / unknown
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

const BATCH = 150;
const AI_FALLBACK_MAX = 10;

const TIER_1 = new Set(["en","ar","fr","es","pt","ru","zh","hi","id","sw","tr","fa","ur","bn","ha","am","uk"]);
const TIER_2 = new Set(["de","it","nl","pl","vi","ja","ko","th","he","el","ro","hu","cs","sv","no","da","fi","ms","fil","ne","my","kk","az","uz"]);

const FAMILY: Record<string, string> = {
  en: "Indo-European", de: "Indo-European", nl: "Indo-European", sv: "Indo-European",
  no: "Indo-European", da: "Indo-European", fr: "Indo-European", es: "Indo-European",
  pt: "Indo-European", it: "Indo-European", ro: "Indo-European", ru: "Indo-European",
  uk: "Indo-European", pl: "Indo-European", cs: "Indo-European", el: "Indo-European",
  hi: "Indo-European", bn: "Indo-European", ur: "Indo-European", ne: "Indo-European",
  fa: "Indo-European",
  ar: "Afro-Asiatic", he: "Afro-Asiatic", am: "Afro-Asiatic", ha: "Afro-Asiatic",
  zh: "Sino-Tibetan", my: "Sino-Tibetan",
  ja: "Japonic", ko: "Koreanic", vi: "Austroasiatic", th: "Kra-Dai",
  id: "Austronesian", ms: "Austronesian", fil: "Austronesian",
  sw: "Niger-Congo",
  tr: "Turkic", kk: "Turkic", az: "Turkic", uz: "Turkic",
  hu: "Uralic", fi: "Uralic",
};

function detectScript(text: string): string {
  const t = text.slice(0, 800);
  if (/[\u0590-\u05FF]/.test(t)) return "Hebr";
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(t)) return "Arab";
  if (/[\u0900-\u097F]/.test(t)) return "Deva";
  if (/[\u0980-\u09FF]/.test(t)) return "Beng";
  if (/[\u1200-\u137F]/.test(t)) return "Ethi";
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(t)) return "Jpan";
  if (/[\uAC00-\uD7AF]/.test(t)) return "Kore";
  if (/[\u4E00-\u9FFF]/.test(t)) return "Hans"; // CJK Unified — assume simplified by default
  if (/[\u0400-\u04FF]/.test(t)) return "Cyrl";
  if (/[\u0E00-\u0E7F]/.test(t)) return "Thai";
  if (/[\u0370-\u03FF]/.test(t)) return "Grek";
  if (/[A-Za-z\u00C0-\u024F]/.test(t)) return "Latn";
  return "Zzzz"; // unknown
}

// Map non-Latin scripts → likely language (high precision)
function langFromScript(script: string): { lang: string; conf: number } | null {
  switch (script) {
    case "Arab": return { lang: "ar", conf: 0.7 };
    case "Hebr": return { lang: "he", conf: 0.95 };
    case "Deva": return { lang: "hi", conf: 0.75 };
    case "Beng": return { lang: "bn", conf: 0.9 };
    case "Ethi": return { lang: "am", conf: 0.85 };
    case "Jpan": return { lang: "ja", conf: 0.95 };
    case "Kore": return { lang: "ko", conf: 0.95 };
    case "Hans": return { lang: "zh", conf: 0.9 };
    case "Cyrl": return { lang: "ru", conf: 0.6 };
    case "Thai": return { lang: "th", conf: 0.95 };
    case "Grek": return { lang: "el", conf: 0.95 };
    default: return null;
  }
}

const LATIN_STOPWORDS: Record<string, string[]> = {
  en: [" the ", " and ", " of ", " to ", " in ", " for ", " on ", " with ", " is ", " by "],
  es: [" el ", " la ", " los ", " las ", " de ", " que ", " en ", " por ", " del ", " una "],
  pt: [" o ", " os ", " do ", " da ", " com ", " para ", " que ", " uma ", " não ", " no "],
  fr: [" le ", " la ", " les ", " des ", " une ", " que ", " dans ", " pour ", " est ", " du "],
  de: [" der ", " die ", " das ", " und ", " mit ", " ist ", " nicht ", " den ", " zu ", " im "],
  it: [" il ", " la ", " che ", " di ", " un ", " una ", " per ", " con ", " del ", " sono "],
  id: [" dan ", " yang ", " untuk ", " dengan ", " adalah ", " tidak ", " ini ", " itu "],
  ms: [" dan ", " yang ", " untuk ", " dengan ", " adalah ", " ini ", " itu ", " tidak "],
  sw: [" na ", " ya ", " kwa ", " katika ", " wa ", " kuwa ", " ni ", " kwamba "],
  nl: [" de ", " het ", " een ", " van ", " en ", " is ", " in ", " op ", " met "],
  pl: [" i ", " w ", " na ", " że ", " do ", " z ", " jest ", " się ", " nie "],
  ro: [" și ", " în ", " de ", " la ", " un ", " care ", " pe ", " cu ", " este "],
  vi: [" và ", " của ", " có ", " được ", " trong ", " là ", " các ", " cho "],
  tr: [" ve ", " bir ", " bu ", " için ", " ile ", " olarak ", " olan ", " da "],
  fil: [" ang ", " ng ", " sa ", " na ", " mga ", " at ", " ay ", " ito "],
  ha: [" da ", " na ", " ya ", " a ", " ba ", " ne ", " kuma ", " su "],
};

function detectLatinLang(text: string): { lang: string; conf: number } {
  const lower = ` ${text.slice(0, 1200).toLowerCase().replace(/[^a-záéíóúñçàèìòùâêîôûäëïöüãõșțăâîă' ]+/g, " ")} `;
  let best = { lang: "und", score: 0 };
  for (const [lang, words] of Object.entries(LATIN_STOPWORDS)) {
    let s = 0;
    for (const w of words) if (lower.includes(w)) s++;
    if (s > best.score) best = { lang, score: s };
  }
  if (best.score >= 3) return { lang: best.lang, conf: 0.85 };
  if (best.score >= 2) return { lang: best.lang, conf: 0.6 };
  return { lang: "und", conf: 0.0 };
}

async function aiDetect(text: string): Promise<{ lang: string; conf: number } | null> {
  try {
    const body = {
      model: MODEL,
      messages: [
        { role: "system", content: "You are a language identifier. Respond ONLY with a JSON object." },
        { role: "user", content: `Identify the language of this text. Respond JSON {"lang":"<ISO 639-1 code, e.g. en, fr, sw>","conf":0..1}.\n\nTEXT: ${text.slice(0, 600)}` },
      ],
      response_format: { type: "json_object" },
    };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const content = j?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    const lang = String(parsed.lang || "").toLowerCase().slice(0, 5);
    const conf = Math.max(0, Math.min(1, Number(parsed.conf) || 0.5));
    return lang ? { lang, conf } : null;
  } catch {
    return null;
  }
}

function tierOf(lang: string): "tier_1" | "tier_2" | "tier_3" | "unknown" {
  if (lang === "und" || !lang) return "unknown";
  if (TIER_1.has(lang)) return "tier_1";
  if (TIER_2.has(lang)) return "tier_2";
  return "tier_3";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let processed = 0, pending = 0, notNeeded = 0, deferLowRes = 0, deferLowRel = 0, aiCalls = 0;

  try {
    const { data: rows, error } = await supa
      .from("global_signals")
      .select("id,title,summary,confidence_score,impact_score,urgency_score,corroboration_count,canonical_event_status,translation_status")
      .is("language_routed_at", null)
      .order("first_detected_at", { ascending: false })
      .limit(BATCH);
    if (error) throw error;

    for (const sig of rows || []) {
      processed++;
      const text = `${sig.title || ""}\n${sig.summary || ""}`.trim();
      const script = detectScript(text);

      let lang = "und";
      let conf = 0;
      let detector = "heuristic";
      let family: string | null = null;

      const fromScript = langFromScript(script);
      if (fromScript) {
        lang = fromScript.lang;
        conf = fromScript.conf;
        detector = "script";
      } else if (script === "Latn") {
        const latin = detectLatinLang(text);
        lang = latin.lang;
        conf = latin.conf;
        detector = "heuristic";
        if (latin.lang === "und" && aiCalls < AI_FALLBACK_MAX && text.length >= 30) {
          const ai = await aiDetect(text);
          aiCalls++;
          if (ai) { lang = ai.lang; conf = ai.conf; detector = "llm"; }
        }
      } else {
        // Zzzz unknown script
        detector = "unknown";
      }

      family = FAMILY[lang] || null;
      const tier = tierOf(lang);
      const isLowRes = tier === "tier_3";

      // Spending guard
      let translationStatus: string;
      let deferReason: string | null = null;
      if (lang === "en") {
        translationStatus = "not_needed";
        notNeeded++;
      } else if (tier === "tier_1" || tier === "tier_2") {
        const meetsRelevance =
          (sig.confidence_score ?? 0) >= 55 ||
          (sig.impact_score ?? 0) >= 60 ||
          (sig.urgency_score ?? 0) >= 60 ||
          (sig.corroboration_count ?? 0) >= 2 ||
          sig.canonical_event_status === "canonical";
        if (meetsRelevance) {
          translationStatus = "pending";
          pending++;
        } else {
          translationStatus = "deferred_low_relevance";
          deferReason = "below relevance threshold for translation";
          deferLowRel++;
        }
      } else {
        translationStatus = "deferred_low_resource";
        deferReason = `low-resource or unknown language (${lang})`;
        deferLowRes++;
      }

      // Don't downgrade an already-translated row
      const finalTranslationStatus =
        sig.translation_status === "translated" || sig.translation_status === "not_needed"
          ? sig.translation_status
          : translationStatus;

      const { error: uErr } = await supa.from("global_signals").update({
        source_language: lang,
        source_language_confidence: conf,
        language_detector: detector,
        language_family: family,
        script_detected: script,
        is_low_resource_language: isLowRes,
        language_tier: tier,
        translation_status: finalTranslationStatus,
        translation_defer_reason: deferReason,
        language_routed_at: new Date().toISOString(),
        last_pipeline_stage: "language_routed",
        original_title: (sig as any).original_title ?? sig.title,
        original_summary: (sig as any).original_summary ?? sig.summary,
      }).eq("id", sig.id);
      if (uErr) throw uErr;
    }

    await supa.from("automation_logs").insert({
      job_name: "language-router",
      status: "success",
      message: `processed=${processed} pending=${pending} not_needed=${notNeeded} defer_low_res=${deferLowRes} defer_low_rel=${deferLowRel} ai_calls=${aiCalls} in ${Date.now() - startedAt}ms`,
    });
    return new Response(JSON.stringify({
      processed, pending, not_needed: notNeeded,
      deferred_low_resource: deferLowRes, deferred_low_relevance: deferLowRel,
      ai_calls: aiCalls,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("language-router error:", msg);
    await supa.from("automation_logs").insert({
      job_name: "language-router", status: "error", message: msg.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
