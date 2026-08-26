import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  // This endpoint fans out a global production workload. Preserve the existing
  // service-role-only trust path while also supporting the independently
  // configured CRON_SECRET and authenticated administrators.
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ success: false, error: "Server configuration incomplete" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let runId = crypto.randomUUID();
  try {
    const body = await req.json().catch(() => ({}));
    const requestedBatchSize = Number(body.batch_size ?? 60);
    const batchSize = Number.isFinite(requestedBatchSize)
      ? Math.max(10, Math.min(100, Math.trunc(requestedBatchSize)))
      : 60;
    if (typeof body.run_id === "string" && /^[0-9a-f-]{36}$/i.test(body.run_id)) {
      runId = body.run_id;
    }

    const { count, error } = await supabase
      .from("country_profiles")
      .select("iso3", { count: "exact", head: true });
    if (error) throw new Error(`Failed to count country profiles: ${error.message}`);

    const total = count ?? 0;
    if (total === 0) {
      await supabase.from("automation_logs").insert({
        job_name: "drive-performance-engine-v2",
        status: "error",
        message: JSON.stringify({ runId, reason: "no_country_profiles" }),
      });
      return json({ success: false, runId, error: "No country profiles available" }, 409);
    }

    const first = await fetch(`${supabaseUrl}/functions/v1/run-performance-engine-v2`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ offset: 0, batch_size: batchSize, run_id: runId }),
    });

    const result = await first.json().catch(() => ({ parse_error: true }));
    if (!first.ok) {
      await supabase.from("automation_logs").insert({
        job_name: "drive-performance-engine-v2",
        status: "error",
        message: JSON.stringify({ runId, total, batchSize, httpStatus: first.status, firstBatch: result }),
      });
      return json({ success: false, runId, total, firstBatch: result }, 502);
    }

    const { error: logError } = await supabase.from("automation_logs").insert({
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
    if (logError) console.error(`Failed to persist driver success log: ${logError.message}`);

    return json({
      success: true,
      runId,
      totalCountries: total,
      batchSize,
      expectedBatches: Math.ceil(total / batchSize),
      firstBatch: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("drive-performance-engine-v2 failed", message);
    await supabase.from("automation_logs").insert({
      job_name: "drive-performance-engine-v2",
      status: "error",
      message: JSON.stringify({ runId, error: message }),
    }).catch(() => undefined);
    return json({ success: false, runId, error: "Global performance orchestration failed" }, 500);
  }
});
