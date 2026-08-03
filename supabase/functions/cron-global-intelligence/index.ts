import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "cron-global-intelligence";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    structuredLog('info', FN, 'Starting global data collection cycle');
    // No 'running' start row: the zombie-job cleaner flips unclosed rows to
    // 'timeout' even on successful runs. Terminal status is logged below.

    const results: Record<string, any> = {};
    const errors: string[] = [];

    // Use direct HTTP calls to avoid nested invocation timeouts
    const functions = [
      "fetch-finance-global",
      "fetch-security-global",
      "fetch-health-global",
      "fetch-food-global",
      "fetch-governance-global",
    ];

    const calls = functions.map(async (fn) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000); // raised from 25s
        const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: "{}",
        });
        clearTimeout(timer);
        const body = await res.text();
        if (res.ok) {
          try { results[fn] = JSON.parse(body); } catch { results[fn] = body; }
        } else {
          errors.push(`${fn}: HTTP ${res.status}`);
        }
      } catch (e) {
        errors.push(`${fn}: ${(e as Error).message}`);
      }
    });

    await Promise.allSettled(calls);

    // Trigger vulnerability calculation
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      await fetch(`${supabaseUrl}/functions/v1/calculate-vulnerability`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: "{}",
      });
      clearTimeout(timer);
    } catch (e) {
      structuredLog('warn', FN, `Vulnerability calc failed: ${(e as Error).message}`);
    }

    // Freshness guardrails
    try {
      const freshnessChecks = [
        { table: 'normalized_metrics', label: 'Metrics' },
        { table: 'normalized_events', label: 'Events' },
        { table: 'country_performance_snapshots', label: 'Snapshots' },
        { table: 'crisis_events', label: 'Crisis' },
      ];

      for (const check of freshnessChecks) {
        const { data } = await supabase
          .from(check.table)
          .select('created_at')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        const lastInsert = data?.created_at ? new Date(data.created_at) : null;
        const hoursAgo = lastInsert ? (Date.now() - lastInsert.getTime()) / 3600000 : Infinity;

        if (hoursAgo > 48) {
          const msg = `STALE: ${check.label} (${check.table}) — no data in ${hoursAgo === Infinity ? '∞' : Math.round(hoursAgo)}h`;
          structuredLog('warn', FN, msg);
          await supabase.from('alerts').insert({
            title: `Data Freshness Alert: ${check.label}`,
            message: msg,
            severity: hoursAgo > 168 ? 'critical' : 'high',
            division: 'system',
            metadata: { type: 'freshness_guardrail', table: check.table, hours_stale: Math.round(hoursAgo) },
          });
        }
      }
    } catch (e) {
      structuredLog('warn', FN, `Freshness check failed: ${(e as Error).message}`);
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: errors.length === 0 ? "success" : "partial",
      message: `Global collection done. ${Object.keys(results).length} OK, ${errors.length} errors. ${errors.slice(0,3).join('; ')}`.slice(0, 500),
    });

    structuredLog('info', FN, `Complete. Errors: ${errors.length}`);
    return jsonResponse({ ok: true, results, errors });
  } catch (e) {
    structuredLog('error', FN, (e as Error).message);
    await supabase.from("automation_logs").insert({
      job_name: FN, status: "error", message: (e as Error).message,
    });
    return errorResponse(e);
  }
});
