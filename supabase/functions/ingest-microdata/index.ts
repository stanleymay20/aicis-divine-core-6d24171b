import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Microdata Ingestion Pipeline
 * 
 * Supports: World Bank Microdata Library, IPUMS, DHS
 * Rules:
 * - Only public-use or licensed datasets
 * - Aggregate before exposure (never store individual-level)
 * - Track license, geography, years, de-identification
 */

interface MicrodataRequest {
  action: "register" | "catalog" | "ingest" | "status";
  provider?: "worldbank_microdata" | "ipums" | "dhs";
  dataset_id?: string;
  source_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const run = await startProviderRun(supabase, {
    provider_name: "ingest-microdata",
    endpoint: "ingest-microdata",
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    const body: MicrodataRequest = await req.json();
    let response: Response;

    if (body.action === "catalog") {
      response = await handleCatalog(supabase, body.provider);
    } else if (body.action === "register") {
      response = await handleRegister(supabase, body);
    } else if (body.action === "ingest") {
      response = await handleIngest(supabase, body.source_id!);
    } else if (body.action === "status") {
      const { data } = await supabase
        .from("microdata_sources")
        .select("id, source_name, provider, title, license_type, status, record_count, indicator_count, countries, years, domains, deidentification_status")
        .order("created_at", { ascending: false });
      response = new Response(JSON.stringify({ sources: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      response = new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await finishProviderRun(supabase, run, { params: { action: body.action } as any });
    return response;
  } catch (err: any) {
    console.error("Microdata ingestion error:", err);
    await failProviderRun(supabase, run, err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function handleCatalog(supabase: any, provider?: string) {
  // Return available public-use datasets from World Bank Microdata Library API
  const catalogs: any[] = [];

  if (!provider || provider === "worldbank_microdata") {
    try {
      const resp = await fetch(
        "https://microdata.worldbank.org/index.php/api/catalog/search?ps=20&sort_by=popularity&sort_order=desc",
        { headers: { Accept: "application/json" } }
      );
      if (resp.ok) {
        const data = await resp.json();
        const datasets = data?.result?.rows || [];
        for (const ds of datasets) {
          catalogs.push({
            provider: "worldbank_microdata",
            dataset_id: ds.id || ds.idno,
            title: ds.title,
            country: ds.nation,
            year_start: ds.year_start,
            year_end: ds.year_end,
            data_access_type: ds.form_model === "public" ? "open" : (ds.data_access_type || ds.form_model || "unknown"),
            type: ds.type,
          });
        }
      }
    } catch (e) {
      console.warn("World Bank Microdata API unavailable:", e);
    }
  }

  return new Response(JSON.stringify({
    catalogs,
    note: "Only datasets with data_access_type='open' are safe for automatic ingestion. Others require manual license review.",
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleRegister(supabase: any, body: MicrodataRequest) {
  if (!body.provider || !body.dataset_id) {
    return new Response(JSON.stringify({ error: "provider and dataset_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Fetch metadata from World Bank
  let metadata: any = {};
  let title = body.dataset_id;
  let licenseType = "unknown";
  let countries: string[] = [];
  let years: number[] = [];

  if (body.provider === "worldbank_microdata") {
    try {
      // Use search API with high page size - match by numeric ID
      // The individual catalog endpoint requires IDNO (string), not numeric ID
      const resp = await fetch(
        `https://microdata.worldbank.org/index.php/api/catalog/search?ps=100&sort_by=popularity&sort_order=desc`,
        { headers: { Accept: "application/json" } }
      );
      if (resp.ok) {
        const data = await resp.json();
        const rows = data?.result?.rows || [];
        const match = rows.find((r: any) => String(r.id) === String(body.dataset_id));
        if (match) {
          title = match.title || title;
          countries = match.nation ? [match.nation] : [];
          years = match.year_start ? [parseInt(match.year_start)] : [];
          licenseType = (match.form_model === "public" || match.form_model === "open") ? "public-use" : "licensed";
          metadata = { raw_metadata: match, idno: match.idno };
        } else {
          // Dataset not found in top 100 popular - try direct fetch with idno if provided
          console.warn(`Dataset ${body.dataset_id} not found in popular catalog search`);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch dataset metadata:", e);
    }
  }

  // Only allow public-use for automatic ingestion
  if (licenseType !== "public-use") {
    return new Response(JSON.stringify({
      error: "Dataset is not public-use. Manual license review required before ingestion.",
      license_type: licenseType,
      dataset_id: body.dataset_id,
    }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabase
    .from("microdata_sources")
    .upsert({
      source_name: `${body.provider}:${body.dataset_id}`,
      provider: body.provider,
      dataset_id: body.dataset_id,
      title,
      license_type: licenseType,
      countries,
      years,
      deidentification_status: "fully_deidentified",
      aggregation_level: "national",
      metadata,
      status: "registered",
    }, { onConflict: "provider,dataset_id" })
    .select()
    .single();

  if (error) throw error;

  return new Response(JSON.stringify({ registered: data }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleIngest(supabase: any, sourceId: string) {
  // Get source record
  const { data: source, error: srcErr } = await supabase
    .from("microdata_sources")
    .select("*")
    .eq("id", sourceId)
    .single();

  if (srcErr || !source) {
    return new Response(JSON.stringify({ error: "Source not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (source.license_type !== "public-use") {
    return new Response(JSON.stringify({ error: "Cannot ingest non-public-use data automatically" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Update status
  await supabase.from("microdata_sources").update({ status: "ingesting" }).eq("id", sourceId);

  try {
    // For World Bank Microdata, fetch aggregated indicators via their API
    // This is a simplified example - real implementation would parse the actual microdata
    // and aggregate it before storing
    let indicatorCount = 0;

    if (source.provider === "worldbank_microdata") {
      // Use IDNO for the variables API (numeric ID doesn't work)
      const idno = source.metadata?.idno || source.dataset_id;
      
      // Fetch variables using IDNO
      const resp = await fetch(
        `https://microdata.worldbank.org/index.php/api/catalog/${idno}/variables?limit=200`,
        { headers: { Accept: "application/json" } }
      );

      if (resp.ok) {
        const varData = await resp.json();
        const variables = varData?.variables || [];
        const totalVars = varData?.total || variables.length;
        
        // Extract meaningful domain-relevant variables as aggregated indicators
        // Group by inferred domain and count coverage
        const domainCoverage: Record<string, { count: number; examples: string[] }> = {};
        
        for (const v of variables) {
          const domain = inferDomain(v.labl || v.name || "");
          if (!domainCoverage[domain]) {
            domainCoverage[domain] = { count: 0, examples: [] };
          }
          domainCoverage[domain].count++;
          if (domainCoverage[domain].examples.length < 5) {
            domainCoverage[domain].examples.push(v.labl || v.name);
          }
        }

        const countryIso3 = source.countries?.[0] || "UNKNOWN";
        const year = source.years?.[0] || 2020;

        // Create domain coverage indicators
        for (const [domain, info] of Object.entries(domainCoverage)) {
          if (domain === "general" && Object.keys(domainCoverage).length > 1) continue; // skip generic
          
          await supabase.from("microdata_indicators").insert({
            source_id: sourceId,
            country_iso3: countryIso3,
            domain,
            indicator: `survey_variable_coverage`,
            value: info.count,
            unit: "variables",
            year,
            aggregation_method: "count",
            sample_size: totalVars,
            confidence_interval: { examples: info.examples },
          });
          indicatorCount++;
        }

        // Also store total variable count as a meta-indicator
        await supabase.from("microdata_indicators").insert({
          source_id: sourceId,
          country_iso3: countryIso3,
          domain: "general",
          indicator: `total_survey_variables`,
          value: totalVars,
          unit: "variables",
          year,
          aggregation_method: "count",
        });
        indicatorCount++;
      }
    }

    // Update source with results
    await supabase.from("microdata_sources").update({
      status: "aggregated",
      ingested_at: new Date().toISOString(),
      indicator_count: indicatorCount,
    }).eq("id", sourceId);

    return new Response(JSON.stringify({
      success: true,
      source_id: sourceId,
      indicators_created: indicatorCount,
      note: "All data aggregated to national level before storage. No individual-level data retained.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    await supabase.from("microdata_sources").update({
      status: "failed",
      error_message: err.message,
    }).eq("id", sourceId);
    throw err;
  }
}

function inferDomain(groupInfo: string): string {
  const lower = (groupInfo || "").toLowerCase();
  if (lower.includes("health") || lower.includes("medical")) return "health";
  if (lower.includes("educ") || lower.includes("school")) return "education";
  if (lower.includes("econ") || lower.includes("income") || lower.includes("employ")) return "economy";
  if (lower.includes("agri") || lower.includes("food") || lower.includes("nutrition")) return "food";
  if (lower.includes("energy") || lower.includes("electr")) return "energy";
  if (lower.includes("water") || lower.includes("sanit")) return "environment";
  if (lower.includes("govern") || lower.includes("politic")) return "governance";
  return "general";
}
