// Synthetic settlement generation is intentionally disabled.
// Historical versions fabricated names, coordinates and populations from
// district centroids. Production AICIS must preserve missing geography as a
// provider gap and populate settlements only from observed/authorized sources.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const FN = "generate-settlements-from-districts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const [{ data: remainingData, error: remainingError }, syntheticResult] = await Promise.all([
      supabase.rpc("count_districts_needing_settlements"),
      supabase
        .from("admin_regions")
        .select("id", { count: "exact", head: true })
        .eq("source", "district_derived"),
    ]);
    if (remainingError) throw remainingError;
    if (syntheticResult.error) throw syntheticResult.error;

    const remaining = Number(remainingData ?? 0);
    const historicalSyntheticRows = syntheticResult.count ?? 0;

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "warning",
      message: `Synthetic settlement generation disabled by truth floor. uncovered_districts=${Number.isFinite(remaining) ? remaining : 0} historical_district_derived_rows=${historicalSyntheticRows}`,
    });

    return json({
      success: true,
      created: 0,
      synthetic_generation_disabled: true,
      uncovered_districts: Number.isFinite(remaining) ? remaining : null,
      historical_synthetic_rows_detected: historicalSyntheticRows,
      cleanup_performed: false,
      reason: "AICIS does not fabricate settlement names, coordinates, populations, or urban/rural classifications.",
      remediation: "Populate missing settlements from provider-backed geography such as OpenStreetMap/Overpass, official national sources, or another authorized observed dataset.",
      authenticated_via: auth.via,
    });
  } catch (error) {
    console.error(`[${FN}]`, error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
