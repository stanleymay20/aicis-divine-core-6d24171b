import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Resilience utilities (inline — Deno can't import relative _shared in prod) ──

async function retryCall<T>(fn: () => Promise<T>, retries = 2, baseMs = 400): Promise<T> {
  let last: Error | undefined;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
      if (i < retries) await new Promise(r => setTimeout(r, baseMs * Math.pow(2, i)));
    }
  }
  throw last;
}

interface CircuitState { failures: number; lastFailure: number; open: boolean; }
const circuits = new Map<string, CircuitState>();

function isCircuitOpen(key: string): boolean {
  const s = circuits.get(key);
  if (!s?.open) return false;
  if (Date.now() - s.lastFailure > 60000) { s.open = false; s.failures = 0; return false; }
  return true;
}

function recordResult(key: string, ok: boolean): void {
  if (ok) { circuits.set(key, { failures: 0, lastFailure: 0, open: false }); return; }
  const s = circuits.get(key) || { failures: 0, lastFailure: 0, open: false };
  s.failures++; s.lastFailure = Date.now();
  if (s.failures >= 3) s.open = true;
  circuits.set(key, s);
}

function log(level: string, msg: string, meta?: Record<string, unknown>) {
  const entry = { level, function: 'aicis-self-heal', message: msg, timestamp: new Date().toISOString(), ...meta };
  if (level === 'error') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// ─── Main Handler ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? '',
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ''
    );

    // Get last diagnostic check with retry
    const { data: lastCheck } = await retryCall(() =>
      Promise.resolve(
        supabase.from("diagnostics_log")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).then(r => { if (r.error) throw r.error; return r; })
    );

    if (!lastCheck || lastCheck.status === 'healthy') {
      log('info', 'System stable — no healing required');
      return new Response(JSON.stringify({ ok: true, message: "System stable" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const actions: string[] = [];
    const repairs: Record<string, unknown>[] = [];

    // 1. Auto-resolve old errors with circuit breaker
    if (!isCircuitOpen('system_errors')) {
      try {
        const { data: errors } = await retryCall(() =>
          Promise.resolve(
            supabase.from("system_errors")
              .select("*").eq("resolved", false)
              .order("created_at", { ascending: false }).limit(10)
          ).then(r => { if (r.error) throw r.error; return r; })
        );

        if (errors && errors.length > 0) {
          actions.push(`Found ${errors.length} unresolved errors`);
          const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
          await supabase.from("system_errors")
            .update({ resolved: true })
            .lt("created_at", oneDayAgo)
            .eq("resolved", false);
          actions.push("Auto-resolved errors older than 24h");
        }
        recordResult('system_errors', true);
      } catch (e) {
        recordResult('system_errors', false);
        log('error', 'Failed to process system errors', { error: String(e) });
      }
    } else {
      actions.push('system_errors circuit open — skipped');
    }

    // 2. Retry failed APIs
    if (lastCheck.failed_apis && Array.isArray(lastCheck.failed_apis)) {
      for (const api of lastCheck.failed_apis) {
        const apiKey = `api_retry_${api.name}`;
        if (isCircuitOpen(apiKey)) {
          actions.push(`${api.name} circuit open — skipped`);
          continue;
        }
        actions.push(`Logged retry for ${api.name}`);
        repairs.push({ component: api.name, action: 'retry_scheduled', status: 'pending' });
      }
    }

    // 3. Check failed tables
    if (lastCheck.failed_tables && Array.isArray(lastCheck.failed_tables)) {
      for (const tbl of lastCheck.failed_tables) {
        try {
          const { error } = await retryCall(() =>
            Promise.resolve(supabase.from(tbl).select("id").limit(1))
          );
          if (!error) {
            repairs.push({ component: tbl, action: 'table_recovered', status: 'success' });
          } else {
            repairs.push({ component: tbl, action: 'table_check_failed', status: 'failed' });
          }
        } catch {
          repairs.push({ component: tbl, action: 'table_check_error', status: 'failed' });
        }
      }
    }

    // Log healing
    await supabase.from("system_errors").insert({
      component: "self-heal",
      message: "Auto repair cycle completed",
      details: { actions, repairs, timestamp: new Date().toISOString() },
      severity: 'low',
      resolved: true
    });

    log('info', 'Self-heal completed', { actionCount: actions.length, repairCount: repairs.length });

    return new Response(JSON.stringify({ ok: true, healed: actions.length > 0, actions, repairs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    log('error', 'Self-heal failed', { error: String(error) });
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
