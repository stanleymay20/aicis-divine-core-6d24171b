import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type UnknownRecord = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown, maxLength = 100): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function boundedTopN(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 100;
  return Math.min(parsed, 200);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publicKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    "";
  const publicClient = createClient(supabaseUrl, publicKey);

  const url = new URL(req.url);
  let mode = url.searchParams.get("mode") ?? "leaderboard";
  let iso3 = url.searchParams.get("iso3") ?? null;
  let domain = url.searchParams.get("domain") ?? null;
  let topN = boundedTopN(url.searchParams.get("top_n"));

  if (req.method === "POST") {
    const bodyUnknown: unknown = await req.json().catch(() => ({}));
    const body = isRecord(bodyUnknown) ? bodyUnknown : {};
    mode = asText(body.mode, 32) ?? mode;
    iso3 = asText(body.iso3, 3) ?? iso3;
    domain = asText(body.domain, 64) ?? domain;
    topN = boundedTopN(body.top_n ?? topN);
  }

  try {
    if (mode === "score") {
      if (!iso3 || !domain) {
        return json({ error: "score mode requires iso3 and domain" }, 400);
      }

      const { data, error } = await publicClient.rpc("score_country_domain_risk", {
        p_iso3: iso3.toUpperCase(),
        p_domain: domain.toLowerCase(),
      });
      if (error) throw error;

      const first = Array.isArray(data) && isRecord(data[0]) ? data[0] : null;
      const probability = first ? first.risk_probability : null;
      const factors = first && isRecord(first.factors) ? first.factors : {};
      const evidenceStatus = asText(factors.evidence_status, 64) ??
        (probability === null ? "insufficient_evidence" : "sufficient");

      return json({
        success: true,
        mode,
        iso3: iso3.toUpperCase(),
        domain: domain.toLowerCase(),
        evidence_status: evidenceStatus,
        probability_semantics:
          probability === null
            ? "no_probability_issued"
            : "uncalibrated_heuristic_probability_estimate",
        result: first,
      });
    }

    if (mode === "refresh") {
      const auth = await requireAdminOrCron(req, corsHeaders);
      if (auth.response) return auth.response;

      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const adminClient = createClient(supabaseUrl, serviceKey);
      const { data, error } = await adminClient.rpc(
        "compute_risk_ranking_baseline",
        { p_top_n: topN },
      );
      if (error) throw error;

      const batchUnknown = Array.isArray(data) ? data[0] : data;
      const batch = isRecord(batchUnknown) ? batchUnknown : {};
      return json({
        success: true,
        mode,
        batch_id: asText(batch.batch_id, 64),
        rows_inserted: Number(batch.rows_inserted) || 0,
        probability_semantics: "uncalibrated_heuristic_probability_estimate",
        calibration_note:
          "Observed base-rate/calibration context is attached separately and is not blended by arbitrary weights.",
      });
    }

    if (mode !== "leaderboard") {
      return json({ error: `Unknown mode: ${mode}` }, 400);
    }

    const { data: latest, error: latestError } = await publicClient
      .from("risk_ranking_predictions")
      .select("generation_batch_id,generated_at,model_version,probability_semantics")
      .eq("evidence_status", "sufficient")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;

    if (!isRecord(latest)) {
      return json({
        success: true,
        mode,
        rows: [],
        generated_at: null,
        refresh_required: true,
        reason: "No evidence-sufficient ranking batch exists. Read requests do not auto-generate privileged data.",
      });
    }

    const batchId = asText(latest.generation_batch_id, 64);
    if (!batchId) {
      return json({ error: "Latest ranking batch is missing an identifier" }, 500);
    }

    let query = publicClient
      .from("risk_ranking_predictions")
      .select("*")
      .eq("generation_batch_id", batchId)
      .eq("evidence_status", "sufficient")
      .order("rank_position", { ascending: true, nullsFirst: false })
      .limit(topN);

    if (domain) query = query.eq("domain", domain.toLowerCase());
    if (iso3) query = query.eq("country_iso3", iso3.toUpperCase());

    const { data: rows, error: rowsError } = await query;
    if (rowsError) throw rowsError;

    return json({
      success: true,
      mode,
      generated_at: latest.generated_at,
      model_version: latest.model_version,
      probability_semantics: latest.probability_semantics,
      rows: rows ?? [],
    });
  } catch (error) {
    console.error("predict-risk-ranking error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
