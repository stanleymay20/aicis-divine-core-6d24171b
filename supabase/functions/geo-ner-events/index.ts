// Geo-NER for orphan normalized_events: uses Lovable AI Gateway (Gemini Flash Lite)
// Picks ISO3 from event title+description, writes back iso3 and metadata.geo_*.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "geo-ner-events";
const MODEL = "google/gemini-2.5-flash-lite";
const BATCH = 40;
const MAX_BATCHES = 6; // ~240 events per invocation; cron cadence handles backlog

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return json({ error: "LOVABLE_API_KEY missing" }, 500);
  }

  const start = Date.now();
  let processed = 0, resolved = 0, batches = 0;

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

      const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: "system",
              content:
                "You extract the most likely primary country from a news headline. Return STRICT JSON: {\"results\":[{\"id\":\"...\",\"iso3\":\"USA\"|null,\"confidence\":0..1}]}. Use null when no country is clearly indicated. Use ISO 3166-1 alpha-3 codes only.",
            },
            { role: "user", content: JSON.stringify(items) },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (ai.status === 429 || ai.status === 402) {
        return json({ ok: false, retry: true, status: ai.status, processed, resolved }, 200);
      }
      if (!ai.ok) {
        const t = await ai.text();
        console.error("AI error", ai.status, t);
        break;
      }
      const aiJson = await ai.json();
      let parsed: { results?: Array<{ id: string; iso3: string | null; confidence?: number }> } = {};
      try { parsed = JSON.parse(aiJson.choices[0].message.content); } catch { parsed = {}; }
      const results = parsed.results ?? [];

      processed += events.length;

      // Apply updates one by one (small batches; safe & idempotent)
      for (const r of results) {
        if (!r?.id || !r.iso3 || !/^[A-Z]{3}$/.test(r.iso3)) continue;
        if ((r.confidence ?? 1) < 0.5) continue;
        const ev = events.find((e) => e.id === r.id);
        const meta = { ...(ev?.metadata ?? {}), geo_method: "gemini-ner", geo_confidence: r.confidence ?? null };
        const { error: upErr } = await supabase
          .from("normalized_events")
          .update({ iso3: r.iso3, country_iso3: r.iso3, metadata: meta })
          .eq("id", r.id);
        if (!upErr) resolved++;
      }
    }

    await supabase.from("system_logs").insert({
      action: "geo_ner_events",
      result: `processed=${processed} resolved=${resolved} batches=${batches}`,
      log_level: "info",
      division: "intelligence",
    });

    return json({ ok: true, processed, resolved, batches, ms: Date.now() - start });
  } catch (e) {
    console.error(FN, e);
    return json({ error: (e as Error).message, processed, resolved }, 500);
  }
});

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
