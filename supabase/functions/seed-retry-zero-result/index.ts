import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
// Sprint α — Truth Floor: daily retry of zero-village countries with backoff.
// Picks countries from village_seed_attempts where next_retry_at <= now() and best_villages_found=0,
// re-invokes village-inference-engine for each, lets that function update retry schedule.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "seed-retry-zero-result";
const MAX_PER_RUN = 25; // do not stampede external APIs

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { data: due, error } = await supabase
      .from("dq_seed_retry_status")
      .select("country_iso3, retry_state, retry_count, next_retry_at")
      .eq("retry_state", "due")
      .order("next_retry_at", { ascending: true })
      .limit(MAX_PER_RUN);
    if (error) throw error;

    const results: Array<{ iso3: string; ok: boolean; error?: string }> = [];

    for (const row of due ?? []) {
      try {
        const r = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/village-inference-engine`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ country_iso3: row.country_iso3, limit: 25 }),
          }
        );
        const ok = r.ok;
        const j = await r.json().catch(() => ({}));
        results.push({ iso3: row.country_iso3, ok, error: ok ? undefined : (j?.error ?? `http_${r.status}`) });
      } catch (e) {
        results.push({ iso3: row.country_iso3, ok: false, error: (e as Error).message });
      }
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "success",
      message: `Retried ${results.length} zero-result seed countries (ok=${results.filter(r => r.ok).length})`,
    });

    return new Response(
      JSON.stringify({ success: true, attempted: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[${FN}]`, msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
