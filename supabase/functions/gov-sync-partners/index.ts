import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    // Check admin role
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isAdmin = roles?.some(r => r.role === "admin" || r.role === "operator");
    if (!isAdmin) throw new Error("Admin access required");

    // Get enabled partners
    const { data: partners } = await supabase
      .from("partner_oracles")
      .select("*")
      .eq("enabled", true);

    let synced = 0;

    let unreachable = 0;
    let unconfigured = 0;

    for (const partner of partners || []) {
      try {
        const endpoint: string | null = partner.api_endpoint ?? null;

        // Previously this applied a random trust delta — fabricated operational data.
        // Trust now moves only on a real reachability measurement of the partner endpoint.
        if (!endpoint) {
          unconfigured++;
          await supabase
            .from("partner_oracles")
            .update({ last_checked: new Date().toISOString() })
            .eq("id", partner.id);
          continue;
        }

        let ok = false;
        try {
          const res = await fetch(endpoint, {
            method: "GET",
            signal: AbortSignal.timeout(8000),
          });
          ok = res.ok;
          await res.body?.cancel().catch(() => {});
        } catch {
          ok = false;
        }

        const current = Number(partner.trust_score) || 0;
        const newTrust = ok
          ? Math.min(100, current + 1)
          : Math.max(0, current - 5);
        if (!ok) unreachable++;

        await supabase
          .from("partner_oracles")
          .update({
            trust_score: newTrust,
            last_checked: new Date().toISOString(),
          })
          .eq("id", partner.id);

        synced++;
      } catch (err) {
        console.error(`Failed to sync ${partner.partner_name}:`, err);
      }
    }


    await supabase.from("system_logs").insert({
      division: "governance",
      action: "gov_sync_partners",
      user_id: user.id,
      log_level: "info",
      result: `Probed ${synced} partner oracles (${unreachable} unreachable, ${unconfigured} without endpoint)`,
    });

    return new Response(
      JSON.stringify({ ok: true, synced, unreachable, unconfigured }),

      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Error in gov-sync-partners:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
