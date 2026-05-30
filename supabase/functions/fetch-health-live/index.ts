import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const FN = "fetch-health-live";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();
  const svc = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const run = await startProviderRun(svc, {
    provider_name: FN,
    endpoint: FN,
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    structuredLog('info', FN, 'Refreshing health data', { user_id: user.id });

    const data = await resilientCall(`${FN}:pull`, async () => {
      const { data, error } = await supabase.functions.invoke('pull-owid-health', { body: {} });
      if (error) throw error;
      return data;
    }, { maxRetries: 1, timeoutMs: 20000 });

    await Promise.allSettled([
      supabase.functions.invoke('evaluate-impact'),
      supabase.functions.invoke('learn-policy-weights'),
    ]);

    structuredLog('info', FN, 'Health data refreshed', undefined, start);
    await finishProviderRun(svc, run, {});
    return jsonResponse({ ok: true, message: "Health data refreshed successfully", data });
  } catch (e) {
    structuredLog('error', FN, (e as Error).message, undefined, start);
    await failProviderRun(svc, run, e);
    return errorResponse(e);
  }
});
