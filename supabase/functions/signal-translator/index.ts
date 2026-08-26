import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
// signal-translator
// Phase 3.1 — Translation execution only.
//
// Language detection + tiering + spend gating live in `language-router`.
// This function only acts on rows with translation_status = 'pending'.
// AI execution is provider-neutral via `_shared/ai-gateway.ts`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH = 50;

interface TranslationResult {
  title: string;
  summary: string | null;
  model: string;
}

async function translate(title: string, summary: string | null): Promise<TranslationResult | null> {
  try {
    const result = await aiChat({
      messages: [
        {
          role: "system",
          content:
            "You translate news headlines and summaries into clear, neutral English. Preserve named entities and numbers exactly. Return ONLY the JSON object requested.",
        },
        {
          role: "user",
          content: `Translate to English. Return JSON {"title":"...","summary":"..."}.\n\nTITLE: ${title}\n\nSUMMARY: ${summary || ""}`,
        },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0,
    });

    const parsed = JSON.parse(result.content) as Record<string, unknown>;
    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : title,
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary
          : summary,
      model: `${result.provider}/${result.model}`,
    };
  } catch (error) {
    console.error(
      "signal-translator provider error",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

Deno.serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let processed = 0;
  let translated = 0;
  let failed = 0;

  try {
    const { data: pending, error } = await supa
      .from("global_signals")
      .select("id,title,summary,original_title,original_summary,source_language")
      .eq("translation_status", "pending")
      .order("first_detected_at", { ascending: false })
      .limit(BATCH);
    if (error) throw error;

    for (const sig of pending || []) {
      processed += 1;
      const baseUpdate: Record<string, unknown> = {
        original_title: sig.original_title ?? sig.title,
        original_summary: sig.original_summary ?? sig.summary,
      };
      const out = await translate(sig.title || "", sig.summary);
      if (!out) {
        await supa
          .from("global_signals")
          .update({ ...baseUpdate, translation_status: "failed" })
          .eq("id", sig.id);
        failed += 1;
        continue;
      }

      await supa
        .from("global_signals")
        .update({
          ...baseUpdate,
          translated_title: out.title,
          translated_summary: out.summary,
          translation_status: "translated",
          translation_model: out.model,
          translated_at: new Date().toISOString(),
          last_pipeline_stage: "translated",
        })
        .eq("id", sig.id);
      translated += 1;
    }

    await supa.from("automation_logs").insert({
      job_name: "signal-translator",
      status: "success",
      message: `processed=${processed} translated=${translated} failed=${failed} in ${Date.now() - startedAt}ms`,
    });

    return new Response(JSON.stringify({ processed, translated, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("signal-translator error:", message);
    await supa.from("automation_logs").insert({
      job_name: "signal-translator",
      status: "error",
      message: message.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
