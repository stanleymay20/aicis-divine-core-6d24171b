import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SECURITY_CATEGORIES = ["cybersecurity", "security", "conflict", "critical_incident"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !publishableKey || !serviceRoleKey) throw new Error("Supabase runtime configuration incomplete");

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { data: roles, error: rolesError } = await userClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (rolesError) throw rolesError;
    const hasPermission = roles?.some((row) => row.role === "admin" || row.role === "operator");
    if (!hasPermission) throw new Error("Insufficient permissions");

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: signals, error: signalError } = await serviceClient
      .from("global_signals")
      .select("id,title,category,geo_admin0_iso3,affected_regions,impact_score,urgency_score,source_credibility_score,corroboration_count,canonical_event_status,first_detected_at")
      .in("category", SECURITY_CATEGORIES)
      .gte("first_detected_at", since24h)
      .or("canonical_event_status.is.null,canonical_event_status.eq.canonical")
      .order("impact_score", { ascending: false, nullsFirst: false })
      .limit(100);
    if (signalError) throw signalError;

    const evidence = (signals ?? []).filter((signal) => {
      const impact = Number(signal.impact_score ?? 0);
      const urgency = Number(signal.urgency_score ?? 0);
      const credibility = Number(signal.source_credibility_score ?? 0);
      const corroboration = Number(signal.corroboration_count ?? 1);
      return (impact >= 45 || urgency >= 45) && (credibility >= 50 || corroboration >= 2);
    });

    const persistedThreats: Array<Record<string, unknown>> = [];
    for (const signal of evidence.slice(0, 25)) {
      const description = `[signal:${signal.id}] ${signal.title}`;
      const { data: existing } = await serviceClient
        .from("threat_logs")
        .select("id")
        .eq("description", description)
        .limit(1);
      if (existing?.length) continue;

      const impact = Number(signal.impact_score ?? 0);
      const urgency = Number(signal.urgency_score ?? 0);
      const score = 0.6 * impact + 0.4 * urgency;
      const severity = score >= 85 ? "critical" : score >= 70 ? "high" : score >= 50 ? "medium" : "low";
      const category = String(signal.category ?? "").toLowerCase();
      const threatType = category.includes("cyber") ? "cyber" : "physical";
      const regions = Array.isArray(signal.affected_regions) ? signal.affected_regions : [];
      const location = signal.geo_admin0_iso3 ?? regions[0] ?? "global";

      const { data: inserted, error: insertError } = await serviceClient
        .from("threat_logs")
        .insert({
          threat_type: threatType,
          severity,
          location,
          description,
          neutralized: false,
        })
        .select()
        .single();
      if (insertError) {
        console.warn("security-scan threat insert failed", insertError.message);
        continue;
      }
      persistedThreats.push(inserted);
    }

    let scanResults: string;
    if (evidence.length === 0) {
      scanResults = "No corroborated security threats met the evidence threshold in the last 24 hours.";
    } else {
      const compactEvidence = evidence.slice(0, 30).map((signal) => ({
        id: signal.id,
        title: signal.title,
        category: signal.category,
        location: signal.geo_admin0_iso3 ?? signal.affected_regions,
        impact_score: signal.impact_score,
        urgency_score: signal.urgency_score,
        source_credibility_score: signal.source_credibility_score,
        corroboration_count: signal.corroboration_count,
        first_detected_at: signal.first_detected_at,
      }));

      try {
        const ai = await aiChat({
          messages: [
            {
              role: "system",
              content: "You are AICIS security intelligence. Summarize only the supplied evidence. Do not invent threats, actors, locations, capabilities, or attribution. Clearly distinguish observed evidence from inference and identify uncertainty.",
            },
            {
              role: "user",
              content: `Analyze these corroborated security signals from the last 24 hours and produce a concise threat briefing:\n${JSON.stringify(compactEvidence)}`,
            },
          ],
          temperature: 0.1,
          maxTokens: 700,
          timeoutMs: 12000,
        });
        scanResults = ai.content;
      } catch (error) {
        console.warn("security-scan AI summary unavailable", error instanceof Error ? error.message : String(error));
        scanResults = `Detected ${evidence.length} corroborated security signals in the last 24 hours; ${persistedThreats.length} new threat records were persisted. AI synthesis unavailable.`;
      }
    }

    await serviceClient.from("system_logs").insert({
      user_id: user.id,
      division: "security",
      action: "security_scan",
      result: "completed",
      log_level: "info",
      metadata: {
        evidence_signals: evidence.length,
        threats_persisted: persistedThreats.length,
        source_window_hours: 24,
        scan_results: scanResults,
      },
    });

    return new Response(JSON.stringify({
      scanResults,
      threats: persistedThreats,
      evidence_count: evidence.length,
      synthetic_threats: 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in security-scan:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : message === "Insufficient permissions" ? 403 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
