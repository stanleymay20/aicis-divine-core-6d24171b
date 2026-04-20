import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    let mode = url.searchParams.get("mode") ?? "list";

    let name = "";
    let domain = "";
    let magnitude = 0.1;
    let iso3: string | null = null;
    let direction = "down";
    let limit = 20;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        mode = body.mode ?? mode;
        name = body.scenario_name ?? body.name ?? "";
        domain = body.domain ?? "";
        magnitude = Number(body.magnitude ?? 0.1);
        iso3 = body.iso3 ?? null;
        direction = body.direction ?? "down";
        limit = Number(body.limit ?? 20);
      } catch {/* */}
    } else {
      limit = Number(url.searchParams.get("limit") ?? "20");
    }

    if (mode === "run") {
      if (!domain || !name) return json({ error: "scenario_name and domain are required" }, 400);
      const { data, error } = await sb.rpc("run_simulation", {
        p_name: name, p_domain: domain, p_magnitude: magnitude,
        p_iso3: iso3, p_direction: direction,
      });
      if (error) throw error;
      const { data: row } = await sb.from("simulation_runs").select("*").eq("id", data).maybeSingle();
      return json({ success: true, mode, simulation: row });
    }

    // list
    const { data: rows, error } = await sb
      .from("simulation_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return json({ success: true, mode, rows: rows ?? [] });
  } catch (e) {
    console.error("run-simulation error:", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
