import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";
import { aiChat } from "../_shared/ai-gateway.ts";

const FN = "adi-conflict-scan";
const WATCHLIST = ["UKR", "PSE", "TWN", "MLI", "SDN", "MMR", "PRK", "COD"];
const clamp = (n: unknown, min: number, max: number, fallback = 0) => {
  const value = Number(n);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const start = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    structuredLog("info", FN, "Starting evidence-grounded conflict scan");
    const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const [{ data: recentSignals }, { data: vulnCountries }, { data: recentCrises }] = await Promise.all([
      supabase
        .from("global_signals")
        .select("id,title,summary,category,geo_admin0_iso3,affected_countries,affected_regions,impact_score,urgency_score,confidence_score,corroboration_count,source_name,first_detected_at")
        .gte("first_detected_at", since48h)
        .in("category", ["armed_conflict", "security", "political_instability", "governance", "civil_unrest"])
        .order("impact_score", { ascending: false, nullsFirst: false })
        .limit(500),
      supabase
        .from("vulnerability_scores")
        .select("country,iso_code,overall_score")
        .gte("overall_score", 70)
        .order("overall_score", { ascending: false })
        .limit(30),
      supabase
        .from("crisis_events")
        .select("region,severity,kind,opened_at")
        .in("status", ["active", "escalated", "monitoring"])
        .gte("severity", 7)
        .gte("opened_at", since48h)
        .order("opened_at", { ascending: false })
        .limit(30),
    ]);

    const byIso = new Map<string, any[]>();
    for (const signal of recentSignals || []) {
      const isoCandidates = new Set<string>();
      if (typeof signal.geo_admin0_iso3 === "string" && /^[A-Z]{3}$/.test(signal.geo_admin0_iso3)) isoCandidates.add(signal.geo_admin0_iso3);
      if (Array.isArray(signal.affected_countries)) {
        for (const iso of signal.affected_countries) if (typeof iso === "string" && /^[A-Z]{3}$/.test(iso)) isoCandidates.add(iso);
      }
      for (const iso of isoCandidates) {
        const list = byIso.get(iso) || [];
        list.push(signal);
        byIso.set(iso, list);
      }
    }

    const vulnMap = new Map((vulnCountries || []).filter((v: any) => /^[A-Z]{3}$/.test(v.iso_code || "")).map((v: any) => [v.iso_code, v]));
    const candidateISO3s = new Set<string>();
    for (const iso of WATCHLIST) if ((byIso.get(iso)?.length || 0) > 0) candidateISO3s.add(iso);
    for (const [iso, evidence] of byIso.entries()) {
      const maxImpact = Math.max(...evidence.map((e) => Number(e.impact_score) || 0));
      const maxUrgency = Math.max(...evidence.map((e) => Number(e.urgency_score) || 0));
      if (evidence.length >= 2 || maxImpact >= 60 || maxUrgency >= 60 || (vulnMap.get(iso)?.overall_score || 0) >= 75) candidateISO3s.add(iso);
    }

    const candidates = [...candidateISO3s].slice(0, 12);
    structuredLog("info", FN, `Evidence supports ${candidates.length} candidate countries`, { watchlist_supported: candidates.filter((i) => WATCHLIST.includes(i)).length });

    const results: any[] = [];
    for (const iso3 of candidates) {
      const evidence = (byIso.get(iso3) || []).slice(0, 20);
      if (evidence.length === 0) continue;

      const avg = (field: string) => evidence.reduce((sum, row) => sum + (Number(row[field]) || 0), 0) / evidence.length;
      const impact = avg("impact_score");
      const urgency = avg("urgency_score");
      const corroboration = evidence.reduce((sum, row) => sum + (Number(row.corroboration_count) || 1), 0);
      const vulnerability = Number(vulnMap.get(iso3)?.overall_score) || 0;
      const baseEscalation = clamp(0.45 * impact + 0.35 * urgency + 0.2 * vulnerability, 0, 95, 0);

      const evidencePacket = evidence.map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        category: row.category,
        source: row.source_name,
        impact_score: row.impact_score,
        urgency_score: row.urgency_score,
        confidence_score: row.confidence_score,
        corroboration_count: row.corroboration_count,
        first_detected_at: row.first_detected_at,
      }));

      const analysis = await resilientCall(`${FN}:ai:${iso3}`, async () => {
        return await aiChat({
          messages: [
            {
              role: "system",
              content: `You are an AICIS conflict-risk analyst in SHADOW MODE. Use only the supplied AICIS evidence. Do not add current events, parties, causes, dates, or historical parallels that are not present in the evidence. Numeric outputs are analytical estimates, not observed facts. Return ONLY JSON: {"protest_momentum":0,"conflict_intensity":0,"military_escalation":0,"diplomatic_tension":0,"media_hostility_index":0,"escalation_probability":0,"conflict_type":null,"involved_parties":[],"triggers":[],"assessment":"...","confidence":0}. Each numeric field is 0-100. If evidence is insufficient for a field, use 0 or null and state the limitation in assessment.`,
            },
            {
              role: "user",
              content: `Country ISO3: ${iso3}\nDeterministic evidence baseline escalation score: ${baseEscalation.toFixed(1)}\nVulnerability score: ${vulnerability || "unavailable"}\nEvidence count: ${evidence.length}\nCorroboration total: ${corroboration}\nEvidence:\n${JSON.stringify(evidencePacket).slice(0, 14000)}`,
            },
          ],
          responseFormat: { type: "json_object" },
          temperature: 0.15,
          maxTokens: 1200,
          timeoutMs: 18000,
        });
      }, { maxRetries: 1, timeoutMs: 22000 });

      let parsed: any;
      try { parsed = JSON.parse(analysis.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()); }
      catch { structuredLog("warn", FN, `Parse failed for ${iso3}`); continue; }

      const escalationProbability = clamp(parsed.escalation_probability, 0, 95, baseEscalation);
      const confidence = Math.min(0.9, Math.max(0.2, clamp(parsed.confidence, 0, 100, 50) / 100));
      const region = (evidence.find((e) => Array.isArray(e.affected_regions) && e.affected_regions.length)?.affected_regions?.[0]) || iso3;

      const { data: signal, error } = await supabase.from("conflict_signals").insert({
        country_iso3: iso3,
        region,
        protest_momentum: clamp(parsed.protest_momentum, 0, 100, 0),
        conflict_intensity: clamp(parsed.conflict_intensity, 0, 100, impact),
        military_escalation: clamp(parsed.military_escalation, 0, 100, 0),
        diplomatic_tension: clamp(parsed.diplomatic_tension, 0, 100, 0),
        media_hostility_index: clamp(parsed.media_hostility_index, 0, 100, 0),
        escalation_probability: escalationProbability,
        time_to_conflict_days: null,
        conflict_type: parsed.conflict_type || null,
        involved_parties: Array.isArray(parsed.involved_parties) ? parsed.involved_parties.slice(0, 12) : [],
        triggers: Array.isArray(parsed.triggers) ? parsed.triggers.slice(0, 12) : [],
        historical_parallels: [],
        assessment_md: `${String(parsed.assessment || "").slice(0, 5000)}\n\n> SHADOW MODE: evidence-grounded analytical estimate; not validated intelligence or a prediction of certain conflict.`,
        data_sources: [...new Set(evidence.map((e) => e.source_name).filter(Boolean))].slice(0, 20),
        confidence,
        status: "active",
      }).select().single();

      if (error || !signal) continue;
      results.push(signal);

      if (escalationProbability >= 60) {
        await supabase.from("adi_decisions").insert({
          signal_source: "conflict_signal",
          signal_id: signal.id,
          signal_summary: `Evidence-grounded conflict escalation estimate ${escalationProbability.toFixed(1)}% for ${iso3}`,
          region,
          country_iso3: iso3,
          domain: "conflict",
          severity_score: escalationProbability / 10,
          options: [],
          reasoning_md: signal.assessment_md,
          confidence,
          status: "pending",
        });
      }
    }

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "success",
      message: `Evidence scan produced ${results.length} conflict signals; ${results.filter((r) => r.escalation_probability >= 60).length} require analyst review`,
    });

    structuredLog("info", FN, `Complete: ${results.length} evidence-grounded signals`, undefined, start);
    return jsonResponse({
      success: true,
      signals: results,
      candidates_considered: candidates.length,
      watchlist_supported_by_recent_evidence: candidates.filter((iso) => WATCHLIST.includes(iso)),
      recent_crises_observed: (recentCrises || []).length,
      execution_time_ms: Date.now() - start,
    });
  } catch (e) {
    structuredLog("error", FN, (e as Error).message, undefined, start);
    return errorResponse(e);
  }
});
