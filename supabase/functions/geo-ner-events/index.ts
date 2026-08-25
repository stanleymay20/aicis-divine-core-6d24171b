// Geo-NER for orphan normalized_events.
// Infers geography only when source text clearly identifies a country and records
// the inference provenance so model-derived geography is never confused with
// provider-supplied geography.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "geo-ner-events";
const BATCH = 40;
const MAX_BATCHES = 6;
const AUTO_WRITE_CONFIDENCE = 0.8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const start = Date.now();
  let processed = 0, resolved = 0, batches = 0, rejected = 0;

  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data: events, error } = await supabase
        .from("normalized_events")
        .select("id, title, description, metadata, provider_name")
        .is("iso3", null)
        .in("provider_name", ["internal:global_signals", "aicis_signals", "internal:crisis_events"])
        .order("created_at", { ascending: false })
        .limit(BATCH);
      if (error) throw error;
      if (!events?.length) break;
      batches++;

      const items = events.map((e) => ({
        id: e.id,
        text: `${e.title ?? ""}. ${(e.description ?? "").slice(0, 280)}`.slice(0, 400),
      }));
      const validIds = new Set(events.map((e) => e.id));

      let result;
      try {
        result = await aiChat({
          messages: [
            {
              role: "system",
              content: "Extract a primary country only when the supplied text clearly identifies one. Return STRICT JSON object: {\"results\":[{\"id\":\"exact supplied id\",\"iso3\":\"USA\"|null,\"confidence\":0..1}]}. Use null when ambiguous, regional, global, or insufficient. ISO 3166-1 alpha-3 only. Do not infer a country merely from a person, company, language, or weak contextual association.",
            },
            { role: "user", content: JSON.stringify(items) },
          ],
          temperature: 0,
          responseFormat: { type: "json_object" },
          timeoutMs: 25_000,
        });
      } catch (e) {
        console.error("Geo NER provider error", e);
        return json({ ok: false, retry: true, processed, resolved, error: "AI provider unavailable" }, 200);
      }

      let parsed: { results?: Array<{ id: string; iso3: string | null; confidence?: number }> } = {};
      try { parsed = JSON.parse(result.content); } catch { parsed = {}; }
      const results = Array.isArray(parsed.results) ? parsed.results : [];

      processed += events.length;

      for (const r of results) {
        if (!r?.id || !validIds.has(r.id)) { rejected++; continue; }
        if (!r.iso3 || !/^[A-Z]{3}$/.test(r.iso3)) continue;
        const confidence = Number(r.confidence);
        if (!Number.isFinite(confidence) || confidence < AUTO_WRITE_CONFIDENCE || confidence > 1) { rejected++; continue; }

        const ev = events.find((e) => e.id === r.id);
        if (!ev) { rejected++; continue; }

        const meta = {
          ...(ev.metadata ?? {}),
          geo_method: "ai_ner_inference",
          geo_confidence: confidence,
          geo_source: "title_description",
          geo_provider: result.provider,
          geo_model: result.model,
          geo_inferred_at: new Date().toISOString(),
        };

        const { error: upErr } = await supabase
          .from("normalized_events")
          .update({ iso3: r.iso3, country_iso3: r.iso3, metadata: meta })
          .eq("id", r.id)
          .is("iso3", null);
        if (!upErr) resolved++;
      }
    }

    await supabase.from("system_logs").insert({
      action: "geo_ner_events",
      result: `processed=${processed} resolved=${resolved} rejected=${rejected} batches=${batches}`,
      log_level: "info",
      division: "intelligence",
      metadata: { auto_write_confidence: AUTO_WRITE_CONFIDENCE, method: "ai_ner_inference" },
    });

    return json({ ok: true, processed, resolved, rejected, batches, ms: Date.now() - start });
  } catch (e) {
    console.error(FN, e);
    return json({ error: (e as Error).message, processed, resolved }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
