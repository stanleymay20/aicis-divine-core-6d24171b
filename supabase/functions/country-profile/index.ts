import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "private, max-age=60",
};

const DOMAINS = [
  "governance",
  "health",
  "education",
  "energy",
  "finance",
  "population",
  "climate",
  "food",
  "security",
] as const;

type Domain = (typeof DOMAINS)[number];

type MetricRow = {
  domain: string;
  metric: string;
  period: string | null;
  value: number | null;
  unit: string | null;
  confidence: number | null;
  source: string | null;
  created_at: string | null;
};

type GeoRow = {
  name: string;
  iso3: string | null;
  lat: number | null;
  lon: number | null;
};

type ProfileMetric = {
  domain: string;
  metric: string;
  period: string;
  value: number;
  unit?: string;
  source: string;
  confidence?: number;
};

type DivisionData = {
  metrics: ProfileMetric[];
  completeness: number;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const cleanSearchTerm = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) return null;
  return trimmed;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { response: authResponse } = await requireUser(req, corsHeaders);
  if (authResponse) return authResponse;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const searchTerm = cleanSearchTerm(body.query) ?? cleanSearchTerm(body.iso3) ?? cleanSearchTerm(body.country);
    if (!searchTerm) {
      return json({ error: "Provide query, iso3, or country" }, 400);
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const normalized = searchTerm.toUpperCase();
    const looksLikeIso3 = /^[A-Z]{3}$/.test(normalized);

    let geo: GeoRow | null = null;
    if (looksLikeIso3) {
      const { data, error } = await supabase
        .from("geo_catalog")
        .select("name,iso3,lat,lon")
        .eq("iso3", normalized)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      geo = data as GeoRow | null;
    } else {
      const { data, error } = await supabase
        .from("geo_catalog")
        .select("name,iso3,lat,lon")
        .ilike("name", searchTerm)
        .not("iso3", "is", null)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      geo = data as GeoRow | null;
    }

    const iso3 = geo?.iso3?.toUpperCase() ?? (looksLikeIso3 ? normalized : null);
    if (!iso3) {
      return json({ error: "Country could not be resolved from the AICIS geography catalog" }, 404);
    }

    const domainResults = await Promise.all(
      DOMAINS.map(async (domain) => {
        const { data, error } = await supabase
          .from("metrics")
          .select("domain,metric,period,value,unit,confidence,source,created_at")
          .eq("iso3", iso3)
          .eq("domain", domain)
          .not("value", "is", null)
          .order("created_at", { ascending: false })
          .limit(150);
        if (error) throw error;
        return [domain, (data ?? []) as MetricRow[]] as const;
      }),
    );

    const profile: Partial<Record<Domain, DivisionData>> = {};
    const missingDomains: string[] = [];
    let domainsWithData = 0;

    for (const [domain, rows] of domainResults) {
      const seen = new Set<string>();
      const metrics: ProfileMetric[] = [];

      for (const row of rows) {
        const value = Number(row.value);
        if (!Number.isFinite(value)) continue;
        const period = row.period ?? row.created_at?.slice(0, 10) ?? "unknown";
        const source = row.source?.trim() || "source_not_recorded";
        const key = `${row.metric}|${period}|${source}`;
        if (seen.has(key)) continue;
        seen.add(key);
        metrics.push({
          domain,
          metric: row.metric,
          period,
          value,
          ...(row.unit ? { unit: row.unit } : {}),
          source,
          ...(typeof row.confidence === "number" ? { confidence: row.confidence } : {}),
        });
      }

      metrics.sort((a, b) => a.period.localeCompare(b.period));

      if (metrics.length === 0) {
        missingDomains.push(domain);
        continue;
      }

      domainsWithData += 1;
      profile[domain] = {
        metrics,
        // This is deliberately domain-presence coverage, not a claim that the
        // country's underlying statistics are exhaustive.
        completeness: 1,
      };
    }

    const completenessOverall = domainsWithData / DOMAINS.length;
    const location = {
      name: geo?.name ?? iso3,
      iso3,
      ...(typeof geo?.lat === "number" ? { lat: geo.lat } : {}),
      ...(typeof geo?.lon === "number" ? { lon: geo.lon } : {}),
    };

    const notes = [
      {
        division: "methodology",
        note: `Coverage is based on ${domainsWithData}/${DOMAINS.length} monitored AICIS domains with stored evidence; it is not a claim of exhaustive national-data completeness.`,
      },
      ...missingDomains.map((domain) => ({
        division: domain,
        note: "No stored metric evidence is currently available for this domain.",
      })),
    ];

    return json({
      ok: true,
      location,
      profile,
      completeness_overall: completenessOverall,
      notes,
      provenance: {
        source: "aicis.metrics",
        assembled_at: new Date().toISOString(),
        user_scoped_rls: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("country-profile error:", message);
    return json({ error: "Country profile unavailable", detail: message }, 500);
  }
});
