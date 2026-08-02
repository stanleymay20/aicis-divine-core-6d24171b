// pipeline-replay
// Backfill / replay tool: reprocesses failed or dropped signals from
// failed-geocode, pending queues, failed translation, missing country
// attribution and stalled enrichment — using the CURRENT pipeline logic.
//
// It never rewrites business fields itself: it only resets pipeline state
// so the live processors (signal-geocoder, signal-translator,
// country-extractor, enrich-global-signals) re-run with the latest code,
// then kicks those processors immediately.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type Lane = "geocode" | "translation" | "country" | "enrichment" | "all";

const LANES: Record<Exclude<Lane, "all">, { rpc: string; args: (limit: number, force: boolean) => Record<string, unknown>; processor: string }> = {
  geocode: {
    rpc: "replay_requeue_geocode",
    args: (limit, force) => ({ p_limit: limit, p_require_country: !force }),
    processor: "signal-geocoder",
  },
  translation: {
    rpc: "replay_requeue_translation",
    args: (limit) => ({ p_limit: limit }),
    processor: "signal-translator",
  },
  country: {
    rpc: "replay_requeue_country",
    args: (limit) => ({ p_limit: limit }),
    processor: "country-extractor",
  },
  enrichment: {
    rpc: "replay_requeue_enrichment",
    args: (limit) => ({ p_limit: limit }),
    processor: "enrich-global-signals",
  },
};

function fireAndForget(fn: string) {
  try {
    fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: ANON_KEY,
        "x-scheduler-source": "pipeline-replay",
      },
      body: JSON.stringify({ source: "pipeline-replay" }),
    }).catch(() => {});
  } catch { /* best effort */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* GET / empty body = summary only */ }

  const lane = (body.lane ?? "all") as Lane;
  const limit = Math.min(Math.max(Number(body.limit ?? 2000), 1), 20000);
  const force = Boolean(body.force); // geocode: also replay rows with no country
  const dryRun = Boolean(body.dry_run);

  try {
    // Always return the current backlog so the caller can render state.
    const { data: summary, error: sErr } = await supa.rpc("replay_backlog_summary");
    if (sErr) throw sErr;

    if (dryRun) {
      return new Response(JSON.stringify({ dry_run: true, backlog: summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lanes = (lane === "all"
      ? (Object.keys(LANES) as Exclude<Lane, "all">[])
      : [lane]) as Exclude<Lane, "all">[];

    const results: Record<string, number> = {};

    for (const l of lanes) {
      const cfg = LANES[l];
      if (!cfg) continue;

      const { data: run } = await supa
        .from("pipeline_replay_runs")
        .insert({
          lane: l,
          mode: force ? "force" : "failed",
          requested_limit: limit,
          status: "running",
        })
        .select("id")
        .single();

      try {
        const { data: requeued, error } = await supa.rpc(cfg.rpc, cfg.args(limit, force));
        if (error) throw error;
        const count = Number(requeued ?? 0);
        results[l] = count;

        if (run?.id) {
          await supa.from("pipeline_replay_runs").update({
            status: "completed",
            requeued_count: count,
            finished_at: new Date().toISOString(),
            notes: `requeued ${count} rows; triggered ${cfg.processor}`,
          }).eq("id", run.id);
        }

        if (count > 0) fireAndForget(cfg.processor);
      } catch (e: any) {
        const msg = e?.message || JSON.stringify(e);
        results[l] = -1;
        if (run?.id) {
          await supa.from("pipeline_replay_runs").update({
            status: "error",
            finished_at: new Date().toISOString(),
            notes: String(msg).slice(0, 500),
          }).eq("id", run.id);
        }
      }
    }

    await supa.from("automation_logs").insert({
      job_name: "pipeline-replay",
      status: Object.values(results).some((v) => v < 0) ? "error" : "success",
      message: `lane=${lane} limit=${limit} force=${force} ${JSON.stringify(results)}`,
    });

    const { data: after } = await supa.rpc("replay_backlog_summary");

    return new Response(JSON.stringify({ ok: true, requeued: results, backlog: after }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || JSON.stringify(e);
    console.error("pipeline-replay error:", msg);
    await supa.from("automation_logs").insert({
      job_name: "pipeline-replay", status: "error", message: String(msg).slice(0, 500),
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
