import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-scheduler-source",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CvssData = {
  baseScore?: number;
  baseSeverity?: string;
};

type CvssMetric = {
  cvssData?: CvssData;
  baseSeverity?: string;
};

type NvdReference = {
  url?: string;
  source?: string;
  tags?: string[];
};

type CpeMatch = { criteria?: string };
type NvdNode = { cpeMatch?: CpeMatch[] };
type NvdConfiguration = { nodes?: NvdNode[] };

type NvdCve = {
  id?: string;
  published?: string;
  lastModified?: string;
  descriptions?: Array<{ lang?: string; value?: string }>;
  references?: NvdReference[];
  configurations?: NvdConfiguration[];
  metrics?: {
    cvssMetricV31?: CvssMetric[];
    cvssMetricV30?: CvssMetric[];
    cvssMetricV2?: CvssMetric[];
  };
};

type NvdResponse = {
  totalResults?: number;
  vulnerabilities?: Array<{ cve?: NvdCve }>;
};

type VulnerabilityRow = {
  cve_id: string;
  description: string;
  severity: string;
  cvss_score: number | null;
  published_date: string | null;
  last_modified: string | null;
  affected_products: string[];
  reference_links: Array<{ url: string; source: string | null; tags: string[] }>;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST" });

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(supabase, {
    provider_name: "nvd",
    endpoint: "pull-nvd-security",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const apiKey = Deno.env.get("NVD_API_KEY") ?? "";
    if (!apiKey) throw new Error("NVD API key not configured");

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    const startDate = sevenDaysAgo.toISOString().split("T")[0];
    const endDate = new Date().toISOString().split("T")[0];
    const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=${startDate}T00:00:00.000&pubEndDate=${endDate}T23:59:59.999&resultsPerPage=50`;

    const response = await fetch(url, { headers: { apiKey } });
    if (!response.ok) throw new Error(`NVD API error: ${response.status} ${response.statusText}`);

    const data = await response.json() as NvdResponse;
    const records: VulnerabilityRow[] = [];

    for (const vulnerability of data.vulnerabilities ?? []) {
      const cve = vulnerability.cve;
      if (!cve?.id) continue;

      const metric = firstMetric(cve);
      const description = cve.descriptions?.find((item) => item.lang === "en")?.value
        ?? cve.descriptions?.[0]?.value
        ?? "No description available";

      const affectedProducts: string[] = [];
      for (const configuration of cve.configurations ?? []) {
        for (const node of configuration.nodes ?? []) {
          for (const match of node.cpeMatch ?? []) {
            if (match.criteria) affectedProducts.push(match.criteria);
          }
        }
      }

      const referenceLinks = (cve.references ?? [])
        .filter((reference) => Boolean(reference.url))
        .map((reference) => ({
          url: String(reference.url),
          source: reference.source ?? null,
          tags: Array.isArray(reference.tags) ? reference.tags : [],
        }));

      records.push({
        cve_id: cve.id,
        description: description.slice(0, 5000),
        severity: metric.severity,
        cvss_score: metric.score,
        published_date: cve.published ?? null,
        last_modified: cve.lastModified ?? null,
        affected_products: affectedProducts.slice(0, 50),
        reference_links: referenceLinks,
      });
    }

    if (records.length > 0) {
      const { error: insertError } = await supabase
        .from("security_vulnerabilities")
        .upsert(records, { onConflict: "cve_id", ignoreDuplicates: false });
      if (insertError) throw insertError;
    }

    await supabase.from("system_logs").insert({
      source: "nvd",
      level: "info",
      message: `Successfully fetched ${records.length} security vulnerabilities`,
      metadata: {
        records_count: records.length,
        total_available: data.totalResults ?? null,
        date_range: `${startDate} to ${endDate}`,
        provenance: "NVD_API",
      },
    });

    await finishProviderRun(supabase, run, {
      records_fetched: records.length,
      records_inserted: records.length,
    });

    return json({
      ok: true,
      message: `Fetched ${records.length} observed NVD vulnerabilities from the last 7 days`,
      records_count: records.length,
    });
  } catch (error) {
    console.error("pull-nvd-security error:", error);
    await failProviderRun(supabase, run, error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function firstMetric(cve: NvdCve): { score: number | null; severity: string } {
  const candidates = [
    cve.metrics?.cvssMetricV31?.[0],
    cve.metrics?.cvssMetricV30?.[0],
    cve.metrics?.cvssMetricV2?.[0],
  ];

  for (const metric of candidates) {
    if (!metric) continue;
    const score = Number(metric.cvssData?.baseScore);
    const severity = metric.cvssData?.baseSeverity ?? metric.baseSeverity ?? "UNKNOWN";
    return { score: Number.isFinite(score) ? score : null, severity };
  }
  return { score: null, severity: "UNKNOWN" };
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
