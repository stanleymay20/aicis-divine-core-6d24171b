import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { enforceRateLimit, requireTier } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const querySchema = z.object({
  query: z.string().trim().min(1).max(2000),
  options: z.object({
    stream: z.boolean().optional(),
    country: z.string().trim().min(1).max(80).optional(),
    domain: z.string().trim().min(1).max(64).optional(),
  }).optional(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  try {
    // The UI already requires sovereign access. Enforce the same boundary here
    // because this function uses the service role to gather cross-table context.
    const { ctx, response: authResponse } = await requireTier(req, "sovereign", corsHeaders);
    if (authResponse || !ctx) return authResponse!;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const rateLimitResponse = await enforceRateLimit({
      supabase,
      req,
      route: `aicis-query:${ctx.user.id}`,
      limit: 30,
      windowSeconds: 60,
      extraHeaders: corsHeaders,
    });
    if (rateLimitResponse) return rateLimitResponse;

    const rawBody = await req.json();
    const { query, options } = querySchema.parse(rawBody);

    const context = await gatherContext(query, options, supabase);
    const aiResponse = await callLovableAI(query, context);

    return new Response(JSON.stringify({
      ok: true,
      query,
      answer: aiResponse.answer,
      intent: aiResponse.intent,
      data: context.data,
      sources: context.sources,
      confidence: aiResponse.confidence,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      function: "aicis-query",
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));

    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid input", details: error.errors }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      ok: false,
      error: "Unable to process intelligence query",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

interface QueryContext {
  data: Record<string, any>;
  sources: string[];
  summary: string;
}

async function gatherContext(
  query: string,
  options: { country?: string; domain?: string } | undefined,
  supabase: any,
): Promise<QueryContext> {
  const q = query.toLowerCase();
  const data: Record<string, any> = {};
  const sources: string[] = [];
  const summaryParts: string[] = [];

  const country = options?.country || extractCountry(q);
  const iso3 = country ? await resolveISO3(country, supabase) : null;
  const domains = options?.domain ? [options.domain] : detectDomains(q);
  const fetches: Promise<void>[] = [];

  if (iso3) {
    fetches.push((async () => {
      const { data: metrics } = await supabase
        .from("normalized_metrics")
        .select("domain, metric_name, value, unit, period, confidence, provider_name")
        .eq("iso3", iso3)
        .order("period", { ascending: false })
        .limit(100);
      if (metrics?.length) {
        data.country_metrics = metrics;
        sources.push("normalized_metrics");
        summaryParts.push(`${metrics.length} metrics for ${iso3}`);
      }
    })());

    fetches.push((async () => {
      const { data: vuln } = await supabase
        .from("vulnerability_scores")
        .select("*")
        .eq("iso3", iso3)
        .order("computed_at", { ascending: false })
        .limit(1);
      if (vuln?.length) {
        data.vulnerability = vuln[0];
        sources.push("vulnerability_scores");
      }
    })());

    fetches.push((async () => {
      const { data: profile } = await supabase
        .from("country_profiles")
        .select("*")
        .eq("iso3", iso3)
        .limit(1);
      if (profile?.length) {
        data.country_profile = profile[0];
        sources.push("country_profiles");
      }
    })());

    fetches.push((async () => {
      const { data: snapshots } = await supabase
        .from("country_performance_snapshots")
        .select("domain, performance_index, risk_pressure_score, momentum_score, forecast_direction, snapshot_date")
        .eq("iso3", iso3)
        .order("snapshot_date", { ascending: false })
        .limit(20);
      if (snapshots?.length) {
        data.performance = snapshots;
        sources.push("country_performance_snapshots");
      }
    })());
  }

  if (q.match(/crisis|incident|attack|conflict|alert|emergency|threat|war/)) {
    fetches.push((async () => {
      const { data: alerts } = await supabase
        .from("critical_alerts")
        .select("headline, level, severity, country, iso3, event_type, triggered_at")
        .order("triggered_at", { ascending: false })
        .limit(25);
      if (alerts?.length) {
        data.critical_alerts = alerts;
        sources.push("critical_alerts");
        summaryParts.push(`${alerts.length} recent critical alerts`);
      }
    })());

    fetches.push((async () => {
      const { data: conflicts } = await supabase
        .from("conflict_signals")
        .select("country_iso3, region, escalation_probability, conflict_type, status, confidence")
        .order("created_at", { ascending: false })
        .limit(20);
      if (conflicts?.length) {
        data.conflict_signals = conflicts;
        sources.push("conflict_signals");
      }
    })());
  }

  if (domains.length > 0 && domains[0] !== "general") {
    fetches.push((async () => {
      let qb = supabase
        .from("normalized_metrics")
        .select("domain, metric_name, iso3, value, unit, period, confidence")
        .in("domain", domains)
        .order("period", { ascending: false })
        .limit(200);
      if (iso3) qb = qb.eq("iso3", iso3);
      const { data: metrics } = await qb;
      if (metrics?.length) {
        data.domain_metrics = metrics;
        sources.push("normalized_metrics");
        summaryParts.push(`${metrics.length} domain metrics across ${domains.join(", ")}`);
      }
    })());
  }

  if (q.match(/intelligence|score|accuracy|prediction|forecast/)) {
    fetches.push((async () => {
      const { data: scores } = await supabase
        .from("intelligence_score_snapshots")
        .select("*")
        .order("computed_at", { ascending: false })
        .limit(5);
      if (scores?.length) {
        data.intelligence_scores = scores;
        sources.push("intelligence_score_snapshots");
      }
    })());
  }

  if (q.match(/decision|recommend|action|outcome/)) {
    fetches.push((async () => {
      const { data: decisions } = await supabase
        .from("adi_decisions")
        .select("domain, signal_summary, status, confidence, severity_score, country_iso3, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (decisions?.length) {
        data.decisions = decisions;
        sources.push("adi_decisions");
      }
    })());
  }

  await Promise.all(fetches);

  return {
    data,
    sources: [...new Set(sources)],
    summary: summaryParts.join("; ") || "General intelligence query",
  };
}

async function callLovableAI(query: string, context: QueryContext) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return {
      answer: `Query processed. Found ${context.sources.length} data sources. ${context.summary}`,
      intent: detectIntent(query),
      confidence: 0.7,
    };
  }

  const systemPrompt = `You are AICIS — the Autonomous Intelligence & Crisis Intervention System. You are a planetary-scale intelligence engine that monitors 229 countries across 16 domains (governance, health, energy, finance, food, climate, security, education, trade, infrastructure, demographics, technology, environment, labor, social, and political stability).

Your role: Synthesize the provided data context into clear, actionable intelligence briefings. Be specific with numbers and trends. Flag risks. Recommend actions when appropriate.

Response format:
- Lead with the key finding or answer
- Support with specific data points from the context
- Flag any risks or anomalies
- Suggest next steps when relevant
- Be concise but thorough — this is for decision-makers

IMPORTANT: Only use data provided in the context. Never fabricate statistics. If data is insufficient, say so explicitly and suggest what additional data to request.`;

  const dataStr = JSON.stringify(context.data, null, 2);
  const userMessage = `Query: "${query}"

Available data context (${context.sources.length} sources: ${context.sources.join(", ")}):
${dataStr.slice(0, 12000)}

${context.summary}

Provide an intelligence briefing answering this query.`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const text = await response.text();
      console.error("AI Gateway error:", status, text.slice(0, 500));

      if (status === 429) {
        return {
          answer: `Rate limit reached. Fallback analysis: ${context.summary}`,
          intent: detectIntent(query),
          confidence: 0.5,
        };
      }

      return {
        answer: `AI analysis unavailable. Data summary: ${context.summary}. ${context.sources.length} data sources queried.`,
        intent: detectIntent(query),
        confidence: 0.5,
      };
    }

    const result = await response.json();
    const answer = result.choices?.[0]?.message?.content || "No analysis generated.";

    return {
      answer,
      intent: detectIntent(query),
      confidence: 0.9,
    };
  } catch (err) {
    console.error("AI call failed:", err);
    return {
      answer: `Analysis fallback: ${context.summary}`,
      intent: detectIntent(query),
      confidence: 0.5,
    };
  }
}

function detectIntent(query: string): string {
  const q = query.toLowerCase();
  if (q.match(/kill|attack|violence|conflict|incident|crisis|shooting|bombing|war|terror/)) return "critical_incidents";
  if (q.match(/country|governance|nation|profile|dashboard/) || q.match(/for\s+\w+/)) return "country_dashboard";
  if (q.match(/map|show|display|overlay|layer/)) return "map_query";
  if (q.match(/predict|forecast|trend|future/)) return "forecasting";
  if (q.match(/decision|recommend|action|outcome/)) return "decision_intelligence";
  if (q.match(/compare|versus|vs|ranking|rank/)) return "comparative";
  return "general";
}

function extractCountry(query: string): string | null {
  const forMatch = query.match(/(?:for|in|of|about)\s+([a-z\s]+?)(?:\s+(?:in|on|during|over|from|since)|[?.!,]|$)/i);
  if (forMatch) {
    const candidate = forMatch[1].trim();
    if (candidate.length >= 2 && candidate.length <= 50) return candidate;
  }
  return null;
}

async function resolveISO3(country: string, supabase: any): Promise<string | null> {
  const isoMap: Record<string, string> = {
    nauru: "NRU", usa: "USA", us: "USA", "united states": "USA",
    germany: "DEU", ghana: "GHA", kenya: "KEN", uk: "GBR",
    "united kingdom": "GBR", france: "FRA", japan: "JPN", china: "CHN",
    india: "IND", brazil: "BRA", russia: "RUS", australia: "AUS",
    canada: "CAN", mexico: "MEX", nigeria: "NGA", "south africa": "ZAF",
    egypt: "EGY", turkey: "TUR", indonesia: "IDN", pakistan: "PAK",
    bangladesh: "BGD", philippines: "PHL", vietnam: "VNM", thailand: "THA",
    "south korea": "KOR", italy: "ITA", spain: "ESP", poland: "POL",
    ukraine: "UKR", iraq: "IRQ", iran: "IRN", syria: "SYR",
    afghanistan: "AFG", yemen: "YEM", somalia: "SOM", sudan: "SDN",
    ethiopia: "ETH", congo: "COD", drc: "COD", colombia: "COL",
    argentina: "ARG", chile: "CHL", peru: "PER", venezuela: "VEN",
    "saudi arabia": "SAU", uae: "ARE", israel: "ISR", palestine: "PSE",
    myanmar: "MMR", taiwan: "TWN", singapore: "SGP", malaysia: "MYS",
    "new zealand": "NZL", sweden: "SWE", norway: "NOR", denmark: "DNK",
    finland: "FIN", netherlands: "NLD", belgium: "BEL", switzerland: "CHE",
    austria: "AUT", portugal: "PRT", greece: "GRC", "czech republic": "CZE",
    romania: "ROU", hungary: "HUN", morocco: "MAR", tunisia: "TUN",
    algeria: "DZA", libya: "LBY", tanzania: "TZA", mozambique: "MOZ",
  };

  const normalized = country.toLowerCase().trim();
  if (isoMap[normalized]) return isoMap[normalized];
  if (/^[A-Z]{3}$/.test(country)) return country;

  const { data } = await supabase
    .from("canonical_entities")
    .select("iso3")
    .ilike("canonical_name", `%${normalized}%`)
    .in("entity_type", ["country", "territory"])
    .limit(1);

  if (data?.[0]?.iso3) return data[0].iso3;
  return null;
}

function detectDomains(query: string): string[] {
  const domains: string[] = [];
  const q = query.toLowerCase();
  if (q.match(/governance|government|policy|corruption|democracy/)) domains.push("governance");
  if (q.match(/health|medical|disease|hospital|mortality|life expectancy/)) domains.push("health");
  if (q.match(/education|school|literacy|student|university/)) domains.push("education");
  if (q.match(/energy|power|electricity|grid|solar|oil|gas/)) domains.push("energy");
  if (q.match(/finance|economic|gdp|debt|trade|inflation|currency/)) domains.push("finance");
  if (q.match(/food|agriculture|hunger|crop|famine/)) domains.push("food");
  if (q.match(/climate|weather|temperature|rain|drought|flood/)) domains.push("climate");
  if (q.match(/security|military|defense|threat|conflict|terrorism/)) domains.push("security");
  if (q.match(/infrastructure|transport|road|water|sanitation/)) domains.push("infrastructure");
  if (q.match(/technology|internet|digital|innovation/)) domains.push("technology");
  return domains.length > 0 ? domains : ["general"];
}
