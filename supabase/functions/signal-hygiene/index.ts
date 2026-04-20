// Signal hygiene: auto-acknowledge expired & stale intelligence_signals.
// Keeps the Escalation Banner clean and bounded.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const start = Date.now();
  const stats = { expired_acked: 0, stale_acked: 0, capped: 0 };

  try {
    // 1. Auto-ack expired signals
    const { data: expired } = await supabase
      .from("intelligence_signals")
      .select("id")
      .eq("acknowledged", false)
      .not("expires_at", "is", null)
      .lt("expires_at", new Date().toISOString())
      .limit(500);
    if (expired?.length) {
      const ids = expired.map((s) => s.id);
      const { error } = await supabase
        .from("intelligence_signals")
        .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
        .in("id", ids);
      if (!error) stats.expired_acked = ids.length;
    }

    // 2. Auto-ack low/medium signals older than 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: stale } = await supabase
      .from("intelligence_signals")
      .select("id")
      .eq("acknowledged", false)
      .in("severity", ["low", "medium"])
      .lt("created_at", sevenDaysAgo)
      .limit(500);
    if (stale?.length) {
      const ids = stale.map((s) => s.id);
      const { error } = await supabase
        .from("intelligence_signals")
        .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
        .in("id", ids);
      if (!error) stats.stale_acked = ids.length;
    }

    // 3. Cap active signals at 50 — auto-ack oldest beyond cap (keep critical/high)
    const { data: active } = await supabase
      .from("intelligence_signals")
      .select("id, severity, created_at")
      .eq("acknowledged", false)
      .order("created_at", { ascending: false })
      .limit(500);

    if (active && active.length > 50) {
      // Sort: critical/high first, then by recency. Anything past index 50 → ack.
      const ranked = active.sort((a, b) => {
        const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        const sa = sevRank[a.severity] ?? 4;
        const sb = sevRank[b.severity] ?? 4;
        if (sa !== sb) return sa - sb;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      const overflow = ranked.slice(50).map((s) => s.id);
      if (overflow.length) {
        const { error } = await supabase
          .from("intelligence_signals")
          .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
          .in("id", overflow);
        if (!error) stats.capped = overflow.length;
      }
    }

    await supabase.from("automation_logs").insert({
      job_name: "signal-hygiene",
      status: "success",
      message: `Expired ${stats.expired_acked}, stale ${stats.stale_acked}, capped ${stats.capped} (${Date.now() - start}ms)`,
    });

    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("automation_logs").insert({ job_name: "signal-hygiene", status: "error", message: msg });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
