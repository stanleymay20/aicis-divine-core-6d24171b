import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const InputSchema = z.object({
  region: z.string().trim().min(1).max(100).optional(),
  regions: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
  country: z.string().trim().min(1).max(100).optional(),
});

function severityScore(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(10, value));
  const text = String(value ?? "").toLowerCase();
  if (text.includes("critical") || text.includes("emergency")) return 10;
  if (text.includes("severe")) return 9;
  if (text.includes("high")) return 8;
  if (text.includes("elevated")) return 7;
  if (text.includes("medium") || text.includes("moderate")) return 5;
  if (text.includes("low")) return 3;
  if (text.includes("minimal") || text.includes("info")) return 1;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(10, numeric)) : 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const validation = InputSchema.safeParse(await req.json().catch(() => ({})));
    if (!validation.success) {
      return new Response(JSON.stringify({ error: "Invalid input", details: validation.error.issues }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { region, regions, country } = validation.data;
    const startTime = Date.now();
    let regionList: string[] = [];

    if (regions?.length) regionList = regions;
    else if (region) regionList = [region];
    else if (country) regionList = [country];
    else {
      const { data } = await serviceClient.from("defense_posture").select("region").order("updated_at", { ascending: false }).limit(20);
      regionList = [...new Set((data || []).map((p: any) => String(p.region || "")).filter(Boolean))];
    }

    if (regionList.length === 0) {
      return new Response(JSON.stringify({ success: true, postures: [], message: "No configured regions to refresh" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];
    for (const reg of regionList.slice(0, 20)) {
      const safeReg = reg.replace(/[(),]/g, " ").trim();
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: incidents, error: incidentError } = await serviceClient
        .from("security_incidents")
        .select("id,threat_type,severity,event_type,country,region,created_at")
        .or(`country.ilike.%${safeReg}%,region.ilike.%${safeReg}%`)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      if (incidentError) {
        console.warn(`Incident query failed for ${reg}:`, incidentError.message);
        continue;
      }

      if (!incidents?.length) continue; // no evidence => no invented posture update

      const scores = incidents.map((i: any) => severityScore(i.severity));
      const maxSeverity = Math.max(...scores, 0);
      const avgSeverity = scores.reduce((a: number, b: number) => a + b, 0) / Math.max(1, scores.length);
      const recentWeight = Math.min(2, Math.log10(incidents.length + 1));
      const threatLevel = Math.max(1, Math.min(10, Math.round((0.65 * maxSeverity + 0.35 * avgSeverity + recentWeight * 0.5) * 10) / 10));

      const evidence = incidents.slice(0, 20).map((i: any) => ({
        id: i.id,
        event_type: i.event_type,
        threat_type: i.threat_type,
        severity: i.severity,
        country: i.country,
        region: i.region,
        created_at: i.created_at,
      }));

      let advisories = `Evidence-backed defensive posture for ${reg}. ${incidents.length} security incidents observed in the last 14 days. Deterministic threat level: ${threatLevel}/10. Manual defensive review recommended.`;
      try {
        const ai = await aiChat({
          messages: [
            { role: "system", content: "You are an AICIS defensive security advisor. Use only supplied incident evidence. Provide defensive recommendations only: monitoring, patching, access control, resilience, incident response, continuity, and hardening. Do not invent incidents, threat actors, capabilities, vulnerabilities, or offensive actions. State uncertainty explicitly." },
            { role: "user", content: `Region: ${reg}\nDeterministic threat level: ${threatLevel}/10\nEvidence:\n${JSON.stringify(evidence).slice(0, 10000)}\n\nGive a concise defensive posture briefing and prioritized mitigations.` },
          ],
          temperature: 0.1,
          maxTokens: 500,
          timeoutMs: 12000,
        });
        advisories = `${ai.content}\n\nEvidence basis: ${incidents.length} recorded incidents (14-day window). Threat level is deterministic, not model-generated. Provider: ${ai.provider}; model: ${ai.model}.`;
      } catch (error) {
        console.warn(`AI advisory unavailable for ${reg}:`, error);
      }

      const { data: posture, error: insertError } = await serviceClient.from("defense_posture").upsert({
        region: reg,
        threat_level: threatLevel,
        advisories_md: advisories,
        updated_at: new Date().toISOString(),
      }, { onConflict: "region" }).select().single();

      if (insertError) console.error(`Defense posture upsert failed for ${reg}:`, insertError.message);
      else if (posture) results.push(posture);
    }

    const executionTime = Date.now() - startTime;
    await serviceClient.from("system_logs").insert({
      action: "defense_posture_refresh",
      division: "defense",
      user_id: user.id,
      log_level: "info",
      result: `Refreshed ${results.length} evidence-backed regional defense postures`,
      metadata: { regions_considered: regionList.length, refreshed: results.length, evidence_window_days: 14, threat_level_method: "recorded_incident_severity", execution_time_ms: executionTime },
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Refreshed defense posture for ${results.length} regions`,
      postures: results,
      methodology: "Threat level derived from recorded incident severity; AI used only for defensive narrative",
      execution_time_ms: executionTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Defense posture refresh error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
