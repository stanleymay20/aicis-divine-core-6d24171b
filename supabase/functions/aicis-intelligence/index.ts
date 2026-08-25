import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireTier } from "../_shared/auth.ts";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Row = Record<string, any>;

type QueryContext = {
  alerts: Row[];
  crises: Row[];
  incidents: Row[];
  intel: Row[];
  countries: Row[];
  vulnerabilities: Row[];
  health: Row[];
  food: Row[];
  energy: Row[];
  metrics: Row[];
};

type DashboardCard = {
  id: string;
  title: string;
  value: string | number;
  riskLevel?: "low" | "medium" | "high" | "critical";
  source: string;
  division: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { ctx, response: gate } = await requireTier(req, "sovereign", corsHeaders);
  if (gate || !ctx) return gate!;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.user.id);

  if (!roles?.some((r: Row) => ["admin", "operator", "analyst"].includes(r.role))) {
    return json({ error: "Forbidden", reason: "role_required" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const conversationHistory = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];

    if (!query || query.length > 4000) {
      return json({ error: "Valid query is required (max 4000 chars)" }, 400);
    }

    const context = await gatherContext(supabase, query);
    const evidenceCount = Object.values(context).reduce((n, rows) => n + rows.length, 0);
    const dataCompleteness = calculateDataCompleteness(context);
    const severity = determineSeverity(context);
    const confidence = calculateConfidence(context, dataCompleteness);
    const dashboards = generateDashboards(context);
    const sources = compileSources(context);
    const locations = context.countries.map((c) => c.country_name || c.name).filter(Boolean);
    const divisions = identifyDivisions(context);
    const location = context.countries[0]
      ? {
          name: context.countries[0].country_name || context.countries[0].name,
          iso3: context.countries[0].iso3 || null,
          lat: context.countries[0].lat ?? null,
          lng: context.countries[0].lon ?? context.countries[0].lng ?? null,
        }
      : undefined;

    let responseContent: string;
    let provider: string | null = null;
    let model: string | null = null;

    if (evidenceCount === 0) {
      responseContent = [
        "AICIS does not currently have sufficient stored evidence to answer this query reliably.",
        "No model-memory fallback was used.",
        "Required next step: ingest or refresh relevant provider data, then rerun the query.",
      ].join(" ");
    } else {
      const evidence = buildEvidencePacket(context);
      const messages = [
        {
          role: "system" as const,
          content: `You are AICIS, an evidence-grounded intelligence synthesis system.\n\nTRUTH FLOOR:\n- Use ONLY the AICIS evidence supplied in this request.\n- Never fill missing facts from model memory or general knowledge.\n- Distinguish observations, derived metrics, forecasts, and recommendations.\n- If evidence is stale, incomplete, contradictory, or absent, say so explicitly.\n- Do not invent casualty figures, prices, laws, probabilities, forecasts, actors, causes, or sources.\n- Recommendations are advisory and must be traceable to supplied evidence.\n- Cite source table names in brackets when making material claims.\n\nReturn a concise executive briefing with: key finding, evidence, uncertainty/limitations, and watch items or next actions.`,
        },
        ...sanitizeHistory(conversationHistory),
        {
          role: "user" as const,
          content: `QUERY:\n${query}\n\nAICIS EVIDENCE PACKET:\n${JSON.stringify(evidence).slice(0, 18000)}\n\nEvidence completeness: ${(dataCompleteness * 100).toFixed(0)}%.`,
        },
      ];

      try {
        const result = await aiChat({ messages, temperature: 0.2, maxTokens: 1800, timeoutMs: 45_000 });
        responseContent = result.content;
        provider = result.provider;
        model = result.model;
      } catch (error) {
        console.error("AICIS intelligence synthesis failed:", error);
        responseContent = deterministicFallback(context, dataCompleteness);
      }
    }

    try {
      await supabase.from("intel_events").insert({
        division: "system",
        event_type: "intelligence_query",
        severity: severity === "critical" ? "critical" : severity === "high" ? "high" : "info",
        title: `Query: ${query.slice(0, 100)}`,
        description: "Evidence-grounded AICIS intelligence query",
        payload: {
          query,
          evidence_count: evidenceCount,
          data_completeness: dataCompleteness,
          source_tables: sources,
          provider,
          model,
        },
        source_system: "AICIS Intelligence",
      });
    } catch (logError) {
      console.error("Failed to log intelligence query:", logError);
    }

    return json({
      success: true,
      response: responseContent,
      summary: responseContent.slice(0, 500),
      briefing: responseContent,
      severity,
      confidence,
      divisions,
      dashboards,
      sources,
      location,
      guidance: generateGuidance(context),
      dataCompleteness,
      metadata: {
        truth_floor: true,
        model_memory_fallback: false,
        evidence_count: evidenceCount,
        locations_analyzed: locations,
        provider,
        model,
        data_sources: Object.fromEntries(Object.entries(context).map(([key, rows]) => [key, rows.length])),
      },
    });
  } catch (error) {
    console.error("AICIS Intelligence error:", error);
    return json({
      error: error instanceof Error ? error.message : "Unknown error",
      response: "AICIS could not complete the evidence-grounded analysis.",
      summary: "Analysis unavailable.",
      severity: "low",
      confidence: 0,
      divisions: [],
      dashboards: [],
      sources: [],
      dataCompleteness: 0,
      metadata: { truth_floor: true, model_memory_fallback: false },
    }, 500);
  }
});

async function gatherContext(supabase: any, query: string): Promise<QueryContext> {
  const [alerts, crises, incidents, intel, health, food, energy, metrics, countryList] = await Promise.all([
    supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(25),
    supabase.from("crisis_events").select("*").order("opened_at", { ascending: false }).limit(20),
    supabase.from("security_incidents").select("*").order("start_time", { ascending: false }).limit(25),
    supabase.from("intel_events").select("*").order("published_at", { ascending: false }).limit(25),
    supabase.from("health_data").select("*").limit(20),
    supabase.from("food_security").select("*").limit(20),
    supabase.from("energy_grid").select("*").limit(20),
    supabase.from("normalized_metrics").select("*").order("period", { ascending: false }).limit(100),
    supabase.from("country_profiles").select("*").limit(250),
  ]);

  const q = query.toLowerCase();
  const countries = (countryList.data || []).filter((c: Row) => {
    const name = String(c.country_name || c.name || "").toLowerCase();
    const iso3 = String(c.iso3 || "").toLowerCase();
    return (name && q.includes(name)) || (iso3.length === 3 && new RegExp(`\\b${iso3}\\b`, "i").test(query));
  }).slice(0, 5);

  const iso3s = countries.map((c: Row) => c.iso3).filter(Boolean);
  let vulnerabilities: Row[] = [];
  if (iso3s.length > 0) {
    const result = await supabase
      .from("vulnerability_scores")
      .select("*")
      .in("iso3", iso3s)
      .order("computed_at", { ascending: false })
      .limit(10);
    vulnerabilities = result.data || [];
  }

  const locationTerms = countries.flatMap((c: Row) => [c.country_name, c.name, c.iso3]).filter(Boolean).map((x: any) => String(x).toLowerCase());
  const filterRelevant = (rows: Row[]) => {
    if (locationTerms.length === 0) return rows;
    return rows.filter((row) => {
      const haystack = JSON.stringify(row).toLowerCase();
      return locationTerms.some((term) => haystack.includes(term));
    });
  };

  return {
    alerts: filterRelevant(alerts.data || []),
    crises: filterRelevant(crises.data || []),
    incidents: filterRelevant(incidents.data || []),
    intel: filterRelevant(intel.data || []),
    countries,
    vulnerabilities,
    health: filterRelevant(health.data || []),
    food: filterRelevant(food.data || []),
    energy: filterRelevant(energy.data || []),
    metrics: iso3s.length > 0 ? (metrics.data || []).filter((m: Row) => iso3s.includes(m.iso3)) : (metrics.data || []),
  };
}

function sanitizeHistory(history: any[]) {
  return history.slice(-8).flatMap((item) => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return [];
    return [{ role: item.role as "user" | "assistant", content: item.content.slice(0, 2000) }];
  });
}

function buildEvidencePacket(context: QueryContext) {
  return {
    alerts: context.alerts.slice(0, 12),
    crises: context.crises.slice(0, 10),
    security_incidents: context.incidents.slice(0, 12),
    intel_events: context.intel.slice(0, 10),
    country_profiles: context.countries.slice(0, 5),
    vulnerability_scores: context.vulnerabilities.slice(0, 5),
    health_data: context.health.slice(0, 10),
    food_security: context.food.slice(0, 10),
    energy_grid: context.energy.slice(0, 10),
    normalized_metrics: context.metrics.slice(0, 40),
  };
}

function compileSources(context: QueryContext): string[] {
  const map: Array<[keyof QueryContext, string]> = [
    ["alerts", "alerts"], ["crises", "crisis_events"], ["incidents", "security_incidents"],
    ["intel", "intel_events"], ["countries", "country_profiles"], ["vulnerabilities", "vulnerability_scores"],
    ["health", "health_data"], ["food", "food_security"], ["energy", "energy_grid"], ["metrics", "normalized_metrics"],
  ];
  return map.filter(([key]) => context[key].length > 0).map(([, table]) => table);
}

function calculateDataCompleteness(context: QueryContext): number {
  const categories = Object.values(context).map((rows) => rows.length > 0);
  return Math.round((categories.filter(Boolean).length / categories.length) * 100) / 100;
}

function calculateConfidence(context: QueryContext, completeness: number): number {
  const evidenceRows = Object.values(context).reduce((n, rows) => n + rows.length, 0);
  if (evidenceRows === 0) return 0;
  const density = Math.min(1, Math.log10(evidenceRows + 1) / 2);
  return Math.round(Math.min(90, (completeness * 60 + density * 30)));
}

function severityFromNumber(value: number): "low" | "medium" | "high" | "critical" {
  if (value >= 8 || value >= 80) return "critical";
  if (value >= 6 || value >= 60) return "high";
  if (value >= 4 || value >= 40) return "medium";
  return "low";
}

function determineSeverity(context: QueryContext): "low" | "medium" | "high" | "critical" {
  if (context.alerts.some((a) => a.severity === "critical")) return "critical";
  if (context.crises.some((c) => Number(c.severity || 0) >= 8)) return "critical";
  if (context.alerts.some((a) => a.severity === "high") || context.crises.some((c) => Number(c.severity || 0) >= 6)) return "high";
  if (context.alerts.length || context.crises.length || context.incidents.length) return "medium";
  return "low";
}

function generateDashboards(context: QueryContext): DashboardCard[] {
  const cards: DashboardCard[] = [];
  if (context.alerts.length) cards.push({ id: "alerts", title: "Recent Alerts", value: context.alerts.length, riskLevel: determineSeverity(context), source: "alerts", division: "Security" });
  const activeCrises = context.crises.filter((c) => c.status !== "resolved");
  if (activeCrises.length) {
    const max = Math.max(...activeCrises.map((c) => Number(c.severity || 0)));
    cards.push({ id: "crises", title: "Active Crises", value: activeCrises.length, riskLevel: severityFromNumber(max), source: "crisis_events", division: "Crisis" });
  }
  const fatalities = context.incidents.reduce((n, row) => n + Number(row.killed || 0), 0);
  if (context.incidents.length) cards.push({ id: "incidents", title: "Recent Security Incidents", value: context.incidents.length, source: "security_incidents", division: "Security" });
  if (fatalities > 0) cards.push({ id: "fatalities", title: "Recorded Fatalities in Loaded Incidents", value: fatalities, source: "security_incidents", division: "Security" });
  if (context.metrics.length) cards.push({ id: "metrics", title: "Recent Normalized Metrics", value: context.metrics.length, source: "normalized_metrics", division: "Intelligence" });
  return cards.slice(0, 8);
}

function identifyDivisions(context: QueryContext): string[] {
  const divisions = new Set<string>();
  if (context.alerts.length || context.incidents.length) divisions.add("Security");
  if (context.crises.length) divisions.add("Crisis");
  if (context.health.length) divisions.add("Health");
  if (context.food.length) divisions.add("Food Security");
  if (context.energy.length) divisions.add("Energy");
  if (context.countries.length || context.vulnerabilities.length) divisions.add("Country Intelligence");
  if (context.metrics.length) divisions.add("Metrics");
  return [...divisions];
}

function generateGuidance(context: QueryContext) {
  const guidance: Array<Record<string, string>> = [];
  if (context.crises.some((c) => Number(c.severity || 0) >= 8)) guidance.push({ priority: "critical", domain: "Crisis", title: "Escalate verified crisis monitoring", description: "High-severity crisis evidence is present.", actionable: "Review the underlying crisis records and corroborating sources before operational action." });
  if (context.alerts.some((a) => ["critical", "high"].includes(a.severity))) guidance.push({ priority: "high", domain: "Security", title: "Review high-severity alerts", description: "High-severity alert records are present.", actionable: "Validate freshness, provenance, and corroboration before escalation." });
  if (!guidance.length) guidance.push({ priority: "low", domain: "Intelligence", title: "Maintain evidence monitoring", description: "No high-severity condition was established by the loaded evidence.", actionable: "Continue ingestion and refresh stale or missing providers." });
  return guidance;
}

function deterministicFallback(context: QueryContext, completeness: number): string {
  const sources = compileSources(context);
  return `AI synthesis is temporarily unavailable. AICIS loaded ${Object.values(context).reduce((n, rows) => n + rows.length, 0)} evidence rows across ${sources.length} source tables (${Math.round(completeness * 100)}% category completeness). No model-memory fallback was used. Review the structured dashboards and source records directly.`;
}
