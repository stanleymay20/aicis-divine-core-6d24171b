import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return json({ error: "Missing x-api-key header" }, 401);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Validate API key
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(apiKey));
  const keyHash = Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");

  const { data: keyRow, error: keyErr } = await sb
    .from("api_keys")
    .select("id, org_id, revoked")
    .eq("key_hash", keyHash)
    .eq("revoked", false)
    .single();

  if (keyErr || !keyRow) {
    return json({ error: "Invalid or revoked API key" }, 403);
  }

  await sb.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id);

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resource = pathParts[1] || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);

  try {
    switch (resource) {
      case "signals": {
        const { data, error } = await sb
          .from("quantivis_signals_feed")
          .select("*")
          .limit(limit);
        if (error) throw error;
        return json({ data, count: data?.length || 0 });
      }

      case "entities": {
        const entityType = url.searchParams.get("type");
        let q = sb.from("quantivis_entity_graph").select("*").limit(limit);
        if (entityType) q = q.eq("entity_type", entityType);
        const { data, error } = await q;
        if (error) throw error;
        return json({ data, count: data?.length || 0 });
      }

      case "countries": {
        const { data, error } = await sb
          .from("quantivis_country_dashboard")
          .select("*")
          .limit(limit);
        if (error) throw error;
        return json({ data, count: data?.length || 0 });
      }

      case "events": {
        const { data, error } = await sb
          .from("quantivis_event_feed")
          .select("*")
          .limit(limit);
        if (error) throw error;
        return json({ data, count: data?.length || 0 });
      }

      case "stats": {
        const [metrics, entities, events, metricLinks, eventLinks, entityLinks] = await Promise.all([
          sb.from("normalized_metrics").select("id", { count: "exact", head: true }),
          sb.from("canonical_entities").select("id", { count: "exact", head: true }),
          sb.from("normalized_events").select("id", { count: "exact", head: true }),
          sb.from("entity_metric_links").select("id", { count: "exact", head: true }),
          sb.from("entity_event_links").select("id", { count: "exact", head: true }),
          sb.from("entity_links").select("id", { count: "exact", head: true }),
        ]);
        return json({
          metrics: metrics.count || 0,
          entities: entities.count || 0,
          events: events.count || 0,
          metric_links: metricLinks.count || 0,
          event_links: eventLinks.count || 0,
          entity_links: entityLinks.count || 0,
          timestamp: new Date().toISOString(),
        });
      }

      default:
        return json({
          api: "Quantivis Bridge API",
          version: "1.0",
          endpoints: [
            "GET /signals",
            "GET /entities",
            "GET /countries",
            "GET /events",
            "GET /stats",
          ],
        });
    }
  } catch (e) {
    console.error("Quantivis bridge error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
