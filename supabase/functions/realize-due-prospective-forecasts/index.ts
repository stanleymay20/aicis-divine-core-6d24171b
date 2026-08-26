import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
// Forecast realization — invoked by daily cron at 02:00 UTC.
// Calls public.realize_due_prospective_forecasts(limit) which only
// touches forecasts whose realization_due_at <= now() and locks them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let limit = 500;
    try {
      if (req.headers.get("content-type")?.includes("application/json")) {
        const body = await req.json();
        if (typeof body?.limit === "number" && body.limit > 0 && body.limit <= 5000) {
          limit = Math.floor(body.limit);
        }
      }
    } catch (_) { /* ignore */ }

    const { data, error } = await supabase.rpc(
      "realize_due_prospective_forecasts",
      { limit_count: limit },
    );

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    console.log("realize-due-prospective-forecasts", row);

    return new Response(
      JSON.stringify({
        ok: true,
        run_id: row?.run_id ?? null,
        rows_realized: row?.rows_realized ?? 0,
        limit,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("realize-due-prospective-forecasts failed", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
