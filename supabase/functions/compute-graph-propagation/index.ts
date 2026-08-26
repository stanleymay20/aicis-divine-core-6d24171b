import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    let mode = url.searchParams.get("mode") ?? "list";
    let topN = Number(url.searchParams.get("top_n") ?? "50");
    let domain = url.searchParams.get("domain") ?? undefined;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        mode = body.mode ?? mode;
        topN = Number(body.top_n ?? topN);
        domain = body.domain ?? domain;
      } catch {/* */}
    }

    if (mode === "compute") {
      const { data, error } = await sb.rpc("compute_risk_propagation");
      if (error) throw error;
      const batch = data?.[0];
      return json({ success: true, mode, batch_id: batch?.batch_id, rows_inserted: batch?.rows_inserted });
    }

    const { data: latest } = await sb
      .from("risk_propagation_score")
      .select("generation_batch_id, computed_at")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      return json({ success: true, mode, generated_at: null, rows: [] });
    }

    let q = sb.from("risk_propagation_score").select("*")
      .eq("generation_batch_id", latest.generation_batch_id)
      .order("propagation_score", { ascending: false })
      .limit(topN);
    if (domain) q = q.eq("domain", domain);
    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) throw rowsErr;

    return json({ success: true, mode, computed_at: latest.computed_at, rows: rows ?? [] });
  } catch (e) {
    console.error("compute-graph-propagation error:", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
