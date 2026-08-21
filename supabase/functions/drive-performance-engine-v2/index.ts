import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const body = await req.json().catch(() => ({}));
  const batchSize = Math.max(10, Math.min(100, Number(body.batch_size ?? 60)));

  const { count, error } = await supabase
    .from("country_profiles")
    .select("iso3", { count: "exact", head: true });
  if (error) throw error;

  const total = count ?? 0;
  if (total === 0) {
    return new Response(JSON.stringify({ success: false, error: "No country profiles available" }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const runId = crypto.randomUUID();
  const first = await fetch(`${supabaseUrl}/functions/v1/run-performance-engine-v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ offset: 0, batch_size: batchSize, run_id: runId }),
  });

  const result = await first.json().catch(() => ({}));
  if (!first.ok) {
    await supabase.from("automation_logs").insert({
      job_name: "drive-performance-engine-v2",
      status: "error",
      message: JSON.stringify({ runId, total, batchSize, firstBatch: result }),
    });
    return new Response(JSON.stringify({ success: false, runId, total, firstBatch: result }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.from("automation_logs").insert({
    job_name: "drive-performance-engine-v2",
    status: "success",
    message: JSON.stringify({
      runId,
      totalCountries: total,
      batchSize,
      expectedBatches: Math.ceil(total / batchSize),
      firstBatch: result,
      continuation: "run-performance-engine-v2 self-chains until all profiles are processed",
    }),
  });

  return new Response(JSON.stringify({
    success: true,
    runId,
    totalCountries: total,
    batchSize,
    expectedBatches: Math.ceil(total / batchSize),
    firstBatch: result,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
