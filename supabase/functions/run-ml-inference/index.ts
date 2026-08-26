import { requireUserOrTrustedWorker } from "../_shared/auth.ts";
// ML inference with raw + isotonic-calibrated scores, prediction intervals,
// and SHA-256 audit hash chain into ml_inference_audit.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL_VERSION = "logistic-baseline-v1";
const WEIGHTS = {
  intercept: -0.4,
  zscore: 0.6,
  trend7: -0.5,
  trend30: -0.4,
  vol: 0.7,
  events7: 0.05,
  ev_severity: 0.3,
  neighbor: 0.4,
  cross_domain: 0.3,
};

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function sigmoid(x: number) { return 1 / (1 + Math.exp(-x)); }

function clip01(x: number) { return Math.max(0, Math.min(1, x)); }

serve(async (req) => {
  const callerAuth = await requireUserOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    let mode = url.searchParams.get("mode") ?? "list";
    let horizon = Number(url.searchParams.get("horizon") ?? "7");
    let topN = Number(url.searchParams.get("top_n") ?? "100");
    let domain = url.searchParams.get("domain") ?? undefined;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        mode = body.mode ?? mode;
        horizon = Number(body.horizon ?? horizon);
        topN = Number(body.top_n ?? topN);
        domain = body.domain ?? domain;
      } catch { /* */ }
    }

    if (mode === "infer") {
      // Pull latest training rows (features) per country-domain
      const { data: trainRows, error: rowErr } = await sb
        .from("training_dataset_aicis")
        .select("country_iso3, domain, metric_zscore_vs_90d, metric_trend_7d, metric_trend_30d, metric_volatility_30d, events_count_7d, event_severity_avg_7d, neighbor_risk_score, cross_domain_pressure, feature_hash, snapshot_date")
        .eq("horizon_days", horizon)
        .order("snapshot_date", { ascending: false })
        .limit(2000);
      if (rowErr) throw rowErr;

      // Fallback to country_performance_snapshots when training set is empty/sparse
      let rows: any[] = trainRows ?? [];
      if (rows.length < 50) {
        const { data: perf } = await sb
          .from("country_performance_snapshots")
          .select("iso3, domain, momentum_score, volatility_index, performance_index, snapshot_date")
          .order("snapshot_date", { ascending: false })
          .limit(2000);
        rows = (perf ?? []).map((p: any) => ({
          country_iso3: p.iso3,
          domain: p.domain,
          metric_zscore_vs_90d: -Number(p.momentum_score ?? 0),
          metric_trend_7d: Number(p.momentum_score ?? 0),
          metric_trend_30d: Number(p.momentum_score ?? 0) * 0.7,
          metric_volatility_30d: Number(p.volatility_index ?? 0),
          events_count_7d: 0,
          event_severity_avg_7d: 0,
          neighbor_risk_score: 0,
          cross_domain_pressure: (100 - Number(p.performance_index ?? 50)) / 100,
          feature_hash: null,
          snapshot_date: p.snapshot_date,
        }));
      }

      // Pull calibration bins for this model+domain
      const { data: cal } = await sb
        .from("model_calibration_bins")
        .select("domain, bin_lower, bin_upper, predicted_mean, empirical_rate")
        .eq("model_version", MODEL_VERSION);

      const calByDomain = new Map<string, Array<{ lo: number; hi: number; pm: number; er: number }>>();
      (cal ?? []).forEach(c => {
        const key = c.domain ?? "*";
        if (!calByDomain.has(key)) calByDomain.set(key, []);
        calByDomain.get(key)!.push({ lo: Number(c.bin_lower), hi: Number(c.bin_upper), pm: Number(c.predicted_mean), er: Number(c.empirical_rate) });
      });

      const calibrate = (raw: number, dom: string): number => {
        const bins = calByDomain.get(dom) ?? calByDomain.get("*") ?? [];
        if (bins.length === 0) return raw;
        const bin = bins.find(b => raw >= b.lo && raw <= b.hi);
        return bin ? clip01(bin.er) : raw;
      };

      const weightsHash = await sha256Hex(JSON.stringify(WEIGHTS));
      const batchId = crypto.randomUUID();
      const generatedAt = new Date().toISOString();

      // Get last audit hash for chain
      const { data: lastAudit } = await sb
        .from("ml_inference_audit")
        .select("combined_hash")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      let prevHash: string | null = lastAudit?.combined_hash ?? null;

      // De-dupe by country-domain (latest snapshot first)
      const seen = new Set<string>();
      const inferences: any[] = [];
      const audits: any[] = [];

      for (const r of rows ?? []) {
        const key = `${r.country_iso3}|${r.domain}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const features = {
          z: Number(r.metric_zscore_vs_90d ?? 0),
          t7: Number(r.metric_trend_7d ?? 0),
          t30: Number(r.metric_trend_30d ?? 0),
          v: Number(r.metric_volatility_30d ?? 0),
          e7: Number(r.events_count_7d ?? 0),
          es: Number(r.event_severity_avg_7d ?? 0),
          nb: Number(r.neighbor_risk_score ?? 0),
          cd: Number(r.cross_domain_pressure ?? 0),
        };

        const logit =
          WEIGHTS.intercept +
          WEIGHTS.zscore * features.z +
          WEIGHTS.trend7 * features.t7 +
          WEIGHTS.trend30 * features.t30 +
          WEIGHTS.vol * features.v +
          WEIGHTS.events7 * Math.log1p(features.e7) +
          WEIGHTS.ev_severity * features.es +
          WEIGHTS.neighbor * features.nb +
          WEIGHTS.cross_domain * features.cd;

        const raw = sigmoid(logit);
        const calibrated = calibrate(raw, r.domain);
        // Bootstrap-style approximate interval: ±1.96 * sqrt(p*(1-p)/n_eff), n_eff=30
        const sd = Math.sqrt(calibrated * (1 - calibrated) / 30);
        const lower = clip01(calibrated - 1.96 * sd);
        const upper = clip01(calibrated + 1.96 * sd);

        const featureHash = r.feature_hash ?? await sha256Hex(JSON.stringify(features));
        const combinedPayload = `${featureHash}|${MODEL_VERSION}|${weightsHash}|${raw.toFixed(6)}|${calibrated.toFixed(6)}`;
        const combinedHash = await sha256Hex(`${prevHash ?? ""}|${combinedPayload}`);

        const predId = crypto.randomUUID();
        inferences.push({
          id: predId,
          country_iso3: r.country_iso3,
          domain: r.domain,
          horizon_days: horizon,
          risk_probability: calibrated,
          baseline_score: raw,
          raw_score: raw,
          calibrated_score: calibrated,
          prediction_interval_lower: lower,
          prediction_interval_upper: upper,
          model_version: MODEL_VERSION,
          generation_batch_id: batchId,
          generated_at: generatedAt,
          feature_snapshot: features,
          feature_contributions: {
            z: WEIGHTS.zscore * features.z,
            t7: WEIGHTS.trend7 * features.t7,
            t30: WEIGHTS.trend30 * features.t30,
            v: WEIGHTS.vol * features.v,
            neighbor: WEIGHTS.neighbor * features.nb,
            cross_domain: WEIGHTS.cross_domain * features.cd,
          },
          audit_hash: combinedHash,
        });
        audits.push({
          prediction_id: predId,
          feature_hash: featureHash,
          model_version: MODEL_VERSION,
          weights_hash: weightsHash,
          combined_hash: combinedHash,
          previous_audit_hash: prevHash,
          generated_at: generatedAt,
        });
        prevHash = combinedHash;
      }

      // Batch insert in chunks of 500
      const chunk = <T,>(arr: T[], n: number) => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
      };
      for (const c of chunk(inferences, 500)) {
        const { error } = await sb.from("risk_ml_predictions").insert(c);
        if (error) throw error;
      }
      for (const c of chunk(audits, 500)) {
        const { error } = await sb.from("ml_inference_audit").insert(c);
        if (error) console.warn("audit insert warning:", error.message);
      }

      return json({
        success: true,
        mode,
        batch_id: batchId,
        rows_inserted: inferences.length,
        model_version: MODEL_VERSION,
        weights_hash: weightsHash,
      });
    }

    // mode === "list"
    const { data: latest } = await sb
      .from("risk_ml_predictions")
      .select("generation_batch_id, generated_at")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) return json({ success: true, mode, rows: [] });

    let q = sb.from("risk_ml_predictions").select("*")
      .eq("generation_batch_id", latest.generation_batch_id)
      .order("calibrated_score", { ascending: false, nullsFirst: false })
      .limit(topN);
    if (domain) q = q.eq("domain", domain);
    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) throw rowsErr;

    return json({ success: true, mode, generated_at: latest.generated_at, rows: rows ?? [] });
  } catch (e) {
    console.error("run-ml-inference error:", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
