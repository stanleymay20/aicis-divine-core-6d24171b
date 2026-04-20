// Ingestor watchdog: detects ingestors that errored or went stale and retriggers them.
// Self-healing layer for fragile fetch-* functions.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Watch {
  name: string;        // edge function name to retrigger
  log_name: string;    // job_name in automation_logs
  max_stale_hours: number;
}

const WATCHED: Watch[] = [
  { name: "fetch-governance-global", log_name: "fetch-governance-global", max_stale_hours: 8 },
  { name: "pull-entsoe", log_name: "pull-entsoe", max_stale_hours: 12 },
  { name: "fetch-satellite-global", log_name: "fetch-satellite-global", max_stale_hours: 12 },
  { name: "cron-global-intelligence", log_name: "cron-global-intelligence", max_stale_hours: 8 },
  { name: "ingest-resilient-events", log_name: "ingest-resilient-events", max_stale_hours: 2 },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const stats: { healed: string[]; healthy: string[]; failed: string[] } = {
    healed: [], healthy: [], failed: [],
  };

  for (const w of WATCHED) {
    try {
      // Most-recent successful run
      const { data: lastSuccess } = await supabase
        .from("automation_logs")
        .select("executed_at")
        .eq("job_name", w.log_name)
        .eq("status", "success")
        .order("executed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const ageH = lastSuccess?.executed_at
        ? (Date.now() - new Date(lastSuccess.executed_at).getTime()) / 3600000
        : 999;

      if (ageH < w.max_stale_hours) {
        stats.healthy.push(w.name);
        continue;
      }

      // Retrigger
      const { error } = await supabase.functions.invoke(w.name, { body: { trigger: "watchdog" } });
      if (error) {
        stats.failed.push(`${w.name}:${error.message}`);
      } else {
        stats.healed.push(w.name);
      }
    } catch (e) {
      stats.failed.push(`${w.name}:${(e as Error).message}`);
    }
  }

  await supabase.from("automation_logs").insert({
    job_name: "ingestor-watchdog",
    status: stats.failed.length > 0 ? "partial" : "success",
    message: `Healthy ${stats.healthy.length}, healed ${stats.healed.length}, failed ${stats.failed.length}`,
  });

  return new Response(JSON.stringify({ ok: true, ...stats }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
