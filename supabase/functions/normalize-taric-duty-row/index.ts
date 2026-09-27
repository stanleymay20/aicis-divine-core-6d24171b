import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { normalizeTaricDutyRow } from "../_shared/taric-duty-row-normalizer-v1.mjs";
import { hashStrategicSnapshot } from "../_shared/strategic-audit-v1.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const input = body?.input ?? body;
    const result = normalizeTaricDutyRow(input);

    if (!result.valid || !result.normalized_measure) {
      return json({
        ok: false,
        code: "taric_row_rejected",
        ...result,
      }, 422);
    }

    const audit = await hashStrategicSnapshot({
      normalizer_version: result.normalizer_version,
      normalized_measure: result.normalized_measure,
      applicability_status: result.applicability_status,
      unresolved_dependencies: result.unresolved_dependencies,
      landed_cost_component: null,
      tariff_rate_claimed_applicable: false,
    });

    try {
      await sb.from("system_logs").insert({
        user_id: user.id,
        division: "finance",
        action: "normalize_taric_duty_row",
        result: "official_measure_normalized_applicability_unresolved",
        log_level: "info",
        metadata: {
          direction: result.normalized_measure.direction,
          goods_code: result.normalized_measure.goods_code,
          measure_type_code: result.normalized_measure.measure_type_code,
          geography_code: result.normalized_measure.geography_code,
          parsed_duty_kind: result.normalized_measure.parsed_duty.kind,
          candidate_rate_pct: result.normalized_measure.parsed_duty.candidate_rate_pct,
          applicability_status: result.applicability_status,
          audit_hash: audit.hash,
          tariff_rate_claimed_applicable: false,
          landed_cost_component_created: false,
        },
      });
    } catch (logError) {
      console.warn("TARIC normalization audit log unavailable", logError);
    }

    return json({
      ok: true,
      ...result,
      audit,
      execution_boundary: {
        tariff_rate_claimed_applicable: false,
        landed_cost_component_created: false,
        customs_declaration_filed: false,
        transaction_mutated: false,
        payment_made: false,
      },
    });
  } catch (error) {
    console.error("normalize-taric-duty-row failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "TARIC row normalization failed",
      tariff_rate_claimed_applicable: false,
      landed_cost_component_created: false,
    }, 500);
  }
});
