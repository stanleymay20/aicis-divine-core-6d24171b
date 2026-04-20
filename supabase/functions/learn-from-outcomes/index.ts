// AICIS Phase 4 — Learning Loop
// Modes:
//   - "realize"     → run realize_risk_predictions(horizon_days)
//   - "performance" → return latest perf rows per domain
//   - "trust"       → return current domain_trust_scores
//   - "realizations"→ recent realized predictions (audit list)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode: string = body.mode ?? "performance";

    if (mode === "realize") {
      const horizon = Math.max(1, Math.min(30, Number(body.horizon_days ?? 7)));
      const { data, error } = await supabase.rpc("realize_risk_predictions", {
        p_horizon_days: horizon,
      });
      if (error) throw error;
      const stats = Array.isArray(data) ? data[0] : data;
      console.log("[learn-from-outcomes] realized:", stats);
      return new Response(JSON.stringify({ ok: true, ...stats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "performance") {
      const limit = Math.min(Number(body.limit ?? 50), 500);
      const { data, error } = await supabase
        .from("model_performance_log")
        .select("*")
        .order("computed_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, rows: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "trust") {
      const { data, error } = await supabase
        .from("domain_trust_scores")
        .select("*")
        .order("trust_score", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, rows: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "realizations") {
      const limit = Math.min(Number(body.limit ?? 100), 500);
      const domain: string | undefined = body.domain;
      let q = supabase
        .from("risk_prediction_realizations")
        .select("*")
        .order("realized_at", { ascending: false })
        .limit(limit);
      if (domain) q = q.eq("domain", domain);
      const { data, error } = await q;
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, rows: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: false, error: `Unknown mode: ${mode}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[learn-from-outcomes] error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
