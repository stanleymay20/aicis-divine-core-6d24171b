// AICIS Decision Layer — Risk Action Recommendation Engine
// Modes:
//   - "list"     → return latest batch of recommendations (optionally filtered)
//   - "generate" → run generate_risk_action_recommendations(top_n) and return the new batch
//   - "update"   → update lifecycle status (accept/dismiss/execute) on a single recommendation

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode: string = body.mode ?? "list";

    // ── LIST ──
    if (mode === "list") {
      const limit = Math.min(Number(body.limit ?? 50), 200);
      const status: string | undefined = body.status;
      const country: string | undefined = body.country_iso3;
      const domain: string | undefined = body.domain;

      let q = supabase
        .from("risk_action_recommendations")
        .select("*")
        .order("rank_position", { ascending: true })
        .limit(limit);

      if (status) q = q.eq("status", status);
      if (country) q = q.eq("country_iso3", country);
      if (domain) q = q.eq("domain", domain);

      // restrict to latest batch unless explicitly asked otherwise
      if (!body.all_batches) {
        const { data: latest } = await supabase
          .from("risk_action_recommendations")
          .select("batch_id, generated_at")
          .order("generated_at", { ascending: false })
          .limit(1);
        const latestBatch = latest?.[0]?.batch_id;
        if (latestBatch) q = q.eq("batch_id", latestBatch);
      }

      const { data, error } = await q;
      if (error) throw error;

      return new Response(
        JSON.stringify({ ok: true, rows: data ?? [], generated_at: data?.[0]?.generated_at ?? null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── GENERATE ──
    if (mode === "generate") {
      const topN = Math.min(Number(body.top_n ?? 50), 200);
      const { data, error } = await supabase.rpc(
        "generate_risk_action_recommendations",
        { p_top_n: topN },
      );
      if (error) throw error;
      const stats = Array.isArray(data) ? data[0] : data;

      // return rows of the new batch
      let rows: any[] = [];
      if (stats?.batch_id) {
        const { data: r } = await supabase
          .from("risk_action_recommendations")
          .select("*")
          .eq("batch_id", stats.batch_id)
          .order("rank_position", { ascending: true });
        rows = r ?? [];
      }

      return new Response(
        JSON.stringify({ ok: true, batch_id: stats?.batch_id, generated: stats?.generated ?? 0, rows }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── UPDATE STATUS ──
    if (mode === "update") {
      const id: string = body.id;
      const status: string = body.status;
      const notes: string | undefined = body.outcome_notes_md;
      if (!id || !["accepted", "dismissed", "executed", "proposed"].includes(status)) {
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid id or status" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const patch: Record<string, unknown> = { status };
      if (status === "accepted") patch.accepted_at = new Date().toISOString();
      if (status === "executed") patch.executed_at = new Date().toISOString();
      if (notes) patch.outcome_notes_md = notes;

      const { data, error } = await supabase
        .from("risk_action_recommendations")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      return new Response(
        JSON.stringify({ ok: true, recommendation: data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: `Unknown mode: ${mode}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[generate-risk-actions] error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
