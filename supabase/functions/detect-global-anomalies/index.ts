import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "detect-global-anomalies";

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();

  try {
    // Use service_role_key so cron can invoke without user auth
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    structuredLog('info', FN, 'Starting global anomaly detection');
    const anomalies: any[] = [];

    // Finance anomalies
    await resilientCall(`${FN}:finance`, async () => {
      const { data: recentFinance } = await supabase
        .from('finance_data')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (recentFinance && recentFinance.length > 10) {
        const values = recentFinance.slice(0, 10).map(r => Number(r.value));
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length);
        const latest = values[0];

        if (stdDev > 0 && Math.abs(latest - avg) > 2 * stdDev) {
          anomalies.push({
            anomaly_type: 'finance_spike',
            division: 'finance',
            severity: latest > avg ? 'medium' : 'high',
            description: `Unusual finance movement: ${latest.toFixed(2)} vs avg ${avg.toFixed(2)}`,
            metrics: { current: latest, average: avg, std_dev: stdDev },
            baseline_metrics: { average: avg },
            deviation_percentage: ((latest - avg) / avg * 100).toFixed(2)
          });
        }
      }
    }, { timeoutMs: 10000 }).catch(e => structuredLog('warn', FN, `Finance anomaly check failed: ${(e as Error).message}`));

    // Energy anomalies
    await resilientCall(`${FN}:energy`, async () => {
      const { data: recentEnergy } = await supabase
        .from('energy_grid')
        .select('*')
        .lt('stability_index', 75)
        .order('updated_at', { ascending: false })
        .limit(10);

      if (recentEnergy && recentEnergy.length > 3) {
        anomalies.push({
          anomaly_type: 'grid_instability',
          division: 'energy',
          severity: 'high',
          description: `${recentEnergy.length} regions experiencing grid instability`,
          metrics: { affected_regions: recentEnergy.length },
          baseline_metrics: { expected_stability: 95 },
          deviation_percentage: null
        });
      }
    }, { timeoutMs: 10000 }).catch(e => structuredLog('warn', FN, `Energy anomaly check failed: ${(e as Error).message}`));

    // Health anomalies
    await resilientCall(`${FN}:health`, async () => {
      const { data: recentHealth } = await supabase
        .from('health_metrics')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (recentHealth && recentHealth.length > 10) {
        const byMetric = new Map<string, number[]>();
        recentHealth.forEach((h: any) => {
          const key = h.metric_name || 'unknown';
          if (!byMetric.has(key)) byMetric.set(key, []);
          byMetric.get(key)!.push(Number(h.value) || 0);
        });

        for (const [metric, values] of byMetric) {
          if (values.length >= 3) {
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const latest = values[0];
            const growthRate = avg > 0 ? ((latest - avg) / avg) * 100 : 0;
            if (Math.abs(growthRate) > 50) {
              anomalies.push({
                anomaly_type: 'health_metric_spike',
                division: 'health',
                severity: Math.abs(growthRate) > 100 ? 'critical' : 'high',
                description: `${metric}: ${growthRate.toFixed(1)}% deviation from baseline`,
                metrics: { metric, current: latest, average: avg, growth_rate: growthRate },
                baseline_metrics: { average: avg },
                deviation_percentage: growthRate.toFixed(2)
              });
            }
          }
        }
      }
    }, { timeoutMs: 10000 }).catch(e => structuredLog('warn', FN, `Health anomaly check failed: ${(e as Error).message}`));

    // Crisis surge check
    await resilientCall(`${FN}:crisis`, async () => {
      const { count: activeCrises } = await supabase
        .from('crisis_events')
        .select('*', { count: 'exact', head: true })
        .in('status', ['active', 'escalated', 'monitoring']);

      if (activeCrises && activeCrises > 5) {
        anomalies.push({
          anomaly_type: 'crisis_surge',
          division: 'crisis',
          severity: 'critical',
          description: `${activeCrises} active crisis events (threshold: 5)`,
          metrics: { active_count: activeCrises },
          baseline_metrics: { expected_active: 2 },
          deviation_percentage: ((activeCrises - 2) / 2 * 100).toFixed(2)
        });
      }
    }, { timeoutMs: 10000 }).catch(e => structuredLog('warn', FN, `Crisis anomaly check failed: ${(e as Error).message}`));

    // Insert anomalies
    if (anomalies.length > 0) {
      for (const anomaly of anomalies) {
        const { error } = await supabase.from('anomaly_detections').insert(anomaly);
        if (error) structuredLog('warn', FN, `Anomaly insert failed: ${error.message}`);
      }
    }

    await supabase.from('automation_logs').insert({
      job_name: FN,
      status: 'success',
      message: `Detected ${anomalies.length} anomalies`
    });

    structuredLog('info', FN, `Complete: ${anomalies.length} anomalies`, undefined, start);
    return jsonResponse({ ok: true, anomalies_count: anomalies.length, anomalies });
  } catch (e) {
    structuredLog('error', FN, (e as Error).message, undefined, start);
    return errorResponse(e);
  }
});
