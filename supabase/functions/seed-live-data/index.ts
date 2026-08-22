import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog } from "../_shared/resilience.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "seed-live-data";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface GDACSEvent {
  eventtype: string;
  eventname: string;
  country: string;
  fromdate: string;
  todate: string;
  alertlevel: string;
  severity: { severity: number; severityUnit: string };
  url: string;
  description: string;
}

interface EONETEvent {
  id: string;
  title: string;
  description?: string;
  categories: { id: string; title: string }[];
  sources: { id: string; url: string }[];
  geometry: { date: string; type: string; coordinates: number[] }[];
}

interface ReliefWebDisaster {
  id: number;
  fields: {
    name: string;
    status: string;
    date: { original: string };
    country: { name: string; iso3: string }[];
    type: { name: string }[];
    primary_type: { name: string };
    description?: string;
  };
}

type Results = {
  crises: number;
  alerts: number;
  intel_events: number;
  security_incidents: number;
  critical_alerts: number;
  skipped_duplicates: number;
  errors: string[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const results: Results = {
    crises: 0,
    alerts: 0,
    intel_events: 0,
    security_incidents: 0,
    critical_alerts: 0,
    skipped_duplicates: 0,
    errors: [],
  };

  const recordSourceError = (source: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    results.errors.push(`${source}: ${message}`.slice(0, 500));
    structuredLog("warn", FN, `${source} ingestion failed`, { error: message });
  };

  const jsonRowExists = async (
    table: string,
    jsonColumn: string,
    value: Record<string, unknown>,
  ): Promise<boolean> => {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .contains(jsonColumn, value)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  };

  try {
    structuredLog("info", FN, "Starting source-grounded live sensing");

    // 1. NASA EONET — authoritative natural-event feed.
    await resilientCall(`${FN}:eonet`, async () => {
      const response = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const events: EONETEvent[] = data.events || [];

      for (const event of events) {
        const category = event.categories[0]?.id;
        const severity = category === "wildfires" ? 8 : category === "severeStorms" ? 7 : 5;
        const { error: crisisError } = await supabase.from("crisis_events").upsert({
          id: `eonet-${event.id}`,
          kind: event.categories[0]?.title || "Natural Event",
          region: event.title.split(" - ")[0] || "Global",
          severity,
          status: "monitoring",
          details_md: `## ${event.title}\n\n${event.description || "Active natural event reported by NASA EONET."}`,
          opened_at: event.geometry[0]?.date || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
        if (crisisError) throw crisisError;
        results.crises++;

        const exists = await jsonRowExists("intel_events", "payload", { event_id: event.id });
        if (exists) {
          results.skipped_duplicates++;
          continue;
        }

        const { error: intelError } = await supabase.from("intel_events").insert({
          division: "crisis",
          event_type: "natural_disaster",
          severity: severity >= 7 ? "critical" : "warning",
          title: event.title,
          description: event.description || `${event.categories[0]?.title || "Natural event"} reported by NASA EONET`,
          payload: {
            source: "NASA_EONET",
            event_id: event.id,
            category: event.categories[0]?.title,
            source_url: event.sources[0]?.url,
          },
          source_system: "NASA EONET",
        });
        if (intelError) throw intelError;
        results.intel_events++;
      }
    }, { maxRetries: 1, timeoutMs: 20_000 }).catch((error) => recordSourceError("EONET", error));

    // 2. GDACS — source-provided alert level; no LLM interpretation.
    await resilientCall(`${FN}:gdacs`, async () => {
      const response = await fetch("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?limit=30&orderby=severity:desc");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const events = parseGDACSXML(await response.text());

      for (const event of events) {
        const severityMap: Record<string, number> = { Red: 9, Orange: 7, Green: 4 };
        const severity = severityMap[event.alertlevel] || 5;
        const eventKey = `${event.eventtype}-${event.fromdate}`;
        const { error } = await supabase.from("critical_alerts").upsert({
          id: `gdacs-${eventKey}`,
          headline: event.eventname,
          level: event.alertlevel?.toLowerCase() || "warning",
          severity,
          country: event.country,
          event_type: event.eventtype,
          meta: { source: "GDACS", url: event.url, event_key: eventKey },
          triggered_at: event.fromdate,
        }, { onConflict: "id" });
        if (error) throw error;
        results.critical_alerts++;
      }
    }, { maxRetries: 1, timeoutMs: 15_000 }).catch((error) => recordSourceError("GDACS", error));

    // 3. ReliefWeb — deduplicate by stable disaster id. "Ongoing" is not
    // automatically treated as "critical"; status and severity are distinct.
    await resilientCall(`${FN}:reliefweb`, async () => {
      const response = await fetch("https://api.reliefweb.int/v1/disasters?appname=aicis&limit=30&preset=latest&fields[include][]=name&fields[include][]=status&fields[include][]=date&fields[include][]=country&fields[include][]=type&fields[include][]=primary_type");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const disasters: ReliefWebDisaster[] = data.data || [];

      for (const disaster of disasters) {
        const country = disaster.fields.country?.[0]?.name || "Global";
        const iso3 = disaster.fields.country?.[0]?.iso3;
        const type = disaster.fields.primary_type?.name || disaster.fields.type?.[0]?.name || "Disaster";

        const alertExists = await jsonRowExists("alerts", "metadata", { disaster_id: disaster.id });
        if (!alertExists) {
          const { error: alertError } = await supabase.from("alerts").insert({
            title: disaster.fields.name,
            message: `${type} affecting ${country}. ReliefWeb status: ${disaster.fields.status}`,
            severity: disaster.fields.status === "ongoing" ? "high" : "medium",
            division: "crisis",
            country,
            metadata: { source: "ReliefWeb", disaster_id: disaster.id, iso3, type },
          });
          if (alertError) throw alertError;
          results.alerts++;
        } else {
          results.skipped_duplicates++;
        }

        if (disaster.fields.status === "ongoing") {
          const incidentExists = await jsonRowExists("security_incidents", "raw", { disaster_id: disaster.id });
          if (!incidentExists) {
            const { error: incidentError } = await supabase.from("security_incidents").insert({
              event_type: "humanitarian_crisis",
              severity: 6,
              title: disaster.fields.name,
              summary: `${type} affecting ${country}; source status is ongoing`,
              country,
              iso3,
              source: "ReliefWeb",
              start_time: disaster.fields.date?.original || new Date().toISOString(),
              raw: { disaster_id: disaster.id, type, source_status: disaster.fields.status },
            });
            if (incidentError) throw incidentError;
            results.security_incidents++;
          } else {
            results.skipped_duplicates++;
          }
        }
      }
    }, { maxRetries: 1, timeoutMs: 15_000 }).catch((error) => recordSourceError("ReliefWeb", error));

    // 4. WHO Disease Outbreak News — disease names are not used as a proxy
    // for outbreak severity. Severity interpretation belongs downstream.
    await resilientCall(`${FN}:who`, async () => {
      const response = await fetch("https://www.who.int/feeds/entity/csr/don/en/rss.xml");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const outbreaks = parseWHORSS(await response.text());

      for (const outbreak of outbreaks.slice(0, 20)) {
        const stableKey = outbreak.link || `${outbreak.title}|${outbreak.pubDate}`;
        const exists = outbreak.link
          ? await jsonRowExists("intel_events", "payload", { link: outbreak.link })
          : await jsonRowExists("intel_events", "payload", { source_key: stableKey });
        if (exists) {
          results.skipped_duplicates++;
          continue;
        }

        const { error } = await supabase.from("intel_events").insert({
          division: "health",
          event_type: "disease_outbreak",
          severity: "warning",
          title: outbreak.title,
          description: outbreak.description,
          payload: {
            source: "WHO",
            link: outbreak.link,
            pubDate: outbreak.pubDate,
            source_key: stableKey,
            severity_interpreted: false,
          },
          source_system: "WHO DON",
        });
        if (error) throw error;
        results.intel_events++;
      }
    }, { maxRetries: 1, timeoutMs: 15_000 }).catch((error) => recordSourceError("WHO", error));

    // 5. USGS earthquakes — stable quake id prevents duplicate alert growth.
    await resilientCall(`${FN}:usgs`, async () => {
      const response = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const quakes = data.features || [];

      for (const quake of quakes) {
        const magnitude = Number(quake.properties?.mag ?? 0);
        const place = String(quake.properties?.place || "Unknown location");
        const coordinates = quake.geometry?.coordinates || [];

        const { error: crisisError } = await supabase.from("crisis_events").upsert({
          id: `usgs-${quake.id}`,
          kind: "Earthquake",
          region: place,
          severity: Math.min(Math.max(Math.round(magnitude), 0), 10),
          status: "monitoring",
          details_md: `## Magnitude ${magnitude} Earthquake\n\n**Location:** ${place}\n**Depth:** ${coordinates[2] ?? "unknown"} km`,
          opened_at: new Date(quake.properties.time).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
        if (crisisError) throw crisisError;
        results.crises++;

        if (magnitude >= 5.5) {
          const exists = await jsonRowExists("alerts", "metadata", { quake_id: quake.id });
          if (exists) {
            results.skipped_duplicates++;
            continue;
          }

          const { error: alertError } = await supabase.from("alerts").insert({
            title: `M${magnitude} Earthquake: ${place}`,
            message: `USGS reports magnitude ${magnitude} at depth ${coordinates[2] ?? "unknown"} km.`,
            severity: magnitude >= 7 ? "critical" : "high",
            division: "crisis",
            country: extractCountryFromPlace(place),
            metadata: {
              source: "USGS",
              quake_id: quake.id,
              magnitude,
              depth: coordinates[2],
              source_url: quake.properties?.url,
            },
          });
          if (alertError) throw alertError;
          results.alerts++;
        }
      }
    }, { maxRetries: 1, timeoutMs: 15_000 }).catch((error) => recordSourceError("USGS", error));

    // 6. NVD vulnerabilities — retain source CVSS only; never invent a score.
    await resilientCall(`${FN}:nvd`, async () => {
      const nvdKey = Deno.env.get("NVD_API_KEY");
      const nvdUrl = nvdKey
        ? "https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=20&cvssV3Severity=CRITICAL"
        : "https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=10";
      const response = await fetch(nvdUrl, { headers: nvdKey ? { apiKey: nvdKey } : {} });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      for (const vulnerability of (data.vulnerabilities || []).slice(0, 20)) {
        const cve = vulnerability.cve;
        const cvss = cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore
          ?? cve.metrics?.cvssMetricV30?.[0]?.cvssData?.baseScore
          ?? null;

        if (cvss == null) continue;
        const exists = await jsonRowExists("security_incidents", "raw", { cve_id: cve.id });
        if (exists) {
          results.skipped_duplicates++;
          continue;
        }

        const { error } = await supabase.from("security_incidents").insert({
          event_type: "vulnerability",
          severity: cvss,
          title: cve.id,
          summary: cve.descriptions?.[0]?.value?.slice(0, 500) || "NVD vulnerability record",
          source: "NVD",
          raw: {
            cve_id: cve.id,
            cvss_score: cvss,
            published: cve.published,
            source_url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
          },
        });
        if (error) throw error;
        results.security_incidents++;
      }
    }, { maxRetries: 1, timeoutMs: 20_000 }).catch((error) => recordSourceError("NVD", error));

    // 7. World Bank / FAO Food Production Index. Compute the change against
    // the immediately preceding available year, not the oldest returned year.
    await resilientCall(`${FN}:wb-food`, async () => {
      const countries = [
        { iso3: "GHA", name: "Ghana" },
        { iso3: "NGA", name: "Nigeria" },
        { iso3: "KEN", name: "Kenya" },
        { iso3: "ZAF", name: "South Africa" },
        { iso3: "IND", name: "India" },
        { iso3: "ETH", name: "Ethiopia" },
        { iso3: "PAK", name: "Pakistan" },
        { iso3: "EGY", name: "Egypt" },
        { iso3: "BGD", name: "Bangladesh" },
        { iso3: "PHL", name: "Philippines" },
      ];
      const isoList = countries.map((country) => country.iso3).join(";");
      const url = `https://api.worldbank.org/v2/country/${isoList}/indicator/AG.PRD.FOOD.XD?format=json&date=2020:2025&per_page=300`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows: any[] = Array.isArray(payload) && payload.length > 1 ? payload[1] : [];

      const histories = new Map<string, { name: string; values: { year: number; value: number }[] }>();
      for (const row of rows) {
        if (row.value == null || !row.countryiso3code) continue;
        const iso3 = String(row.countryiso3code);
        const year = Number(row.date);
        const value = Number(row.value);
        if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
        const name = countries.find((country) => country.iso3 === iso3)?.name || row.country?.value || iso3;
        const history = histories.get(iso3) || { name, values: [] };
        history.values.push({ year, value });
        histories.set(iso3, history);
      }

      for (const [iso3, history] of histories) {
        history.values.sort((a, b) => b.year - a.year);
        const latest = history.values[0];
        const previous = history.values[1];
        if (!latest) continue;

        const change = previous && previous.value !== 0
          ? ((latest.value - previous.value) / previous.value) * 100
          : null;
        const declining = change != null && change < -2;
        const stagnating = change != null && Math.abs(change) < 2;
        const impact = change == null ? 3 : declining ? 7 : stagnating ? 4 : 3;
        const urgency = change == null ? 2 : declining ? 6 : 3;
        const changeText = change == null
          ? "prior-year comparison unavailable"
          : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs ${previous.year}`;
        const trend = change == null
          ? "Unclassified"
          : declining
            ? "Declining"
            : stagnating
              ? "Stable"
              : "Growing";

        const { error } = await supabase.from("global_signals").insert({
          title: `${history.name} food production index ${latest.year}: ${latest.value.toFixed(1)} (${changeText})`.slice(0, 240),
          summary: `${trend} food production index for ${history.name}. Latest available World Bank / FAO value: ${latest.value.toFixed(1)} (2014–16 = 100). ${change == null ? "No adjacent prior-year value was available in the response." : `Change is measured against the immediately preceding available year (${previous.year}).`}`.slice(0, 800),
          category: "food_agriculture",
          subcategory: "food_production_index",
          status: "developing",
          impact_score: impact,
          urgency_score: urgency,
          primary_source: "World Bank / FAO",
          source_count: 1,
          ingestion_source: "worldbank_food",
          first_detected_at: new Date().toISOString(),
          latest_update_at: new Date().toISOString(),
          occurred_at: new Date(`${latest.year}-12-31T00:00:00Z`).toISOString(),
          affected_countries: [iso3],
          source_trust_tier: "official",
          official_source: true,
          dedup_key: `wb-food-${iso3}-${latest.year}`,
        });
        if (error) {
          if (error.message.toLowerCase().includes("duplicate")) results.skipped_duplicates++;
          else throw error;
        } else {
          results.intel_events++;
        }
      }
    }, { maxRetries: 2, timeoutMs: 15_000 }).catch((error) => recordSourceError("World Bank food", error));

    // Deliberately no streamflow "below normal" sensor here. Absolute discharge
    // cannot establish an anomaly without a site-specific historical baseline.

    // 8. UNHCR — treat the response as the returned sample, not as a complete
    // global ranking unless pagination/exhaustiveness is separately certified.
    await resilientCall(`${FN}:unhcr`, async () => {
      const yearNow = new Date().getFullYear();
      const response = await fetch(`https://api.unhcr.org/population/v1/population/?yearFrom=${yearNow - 1}&yearTo=${yearNow}&coo_all=true&limit=1000`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const items = data.items || [];

      const flows: Record<string, { refugees: number; asylum: number; idps: number; coo_name: string }> = {};
      for (const item of items) {
        const origin = item.coo_iso || item.coo;
        if (!origin) continue;
        if (!flows[origin]) {
          flows[origin] = {
            refugees: 0,
            asylum: 0,
            idps: 0,
            coo_name: item.coo_name || origin,
          };
        }
        flows[origin].refugees += Number.parseInt(item.refugees || "0", 10) || 0;
        flows[origin].asylum += Number.parseInt(item.asylum_seekers || "0", 10) || 0;
        flows[origin].idps += Number.parseInt(item.idps || "0", 10) || 0;
      }

      const returnedLeaders = Object.entries(flows)
        .map(([iso3, flow]) => ({ iso3, ...flow, total: flow.refugees + flow.asylum + flow.idps }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      for (const flow of returnedLeaders) {
        if (flow.total < 1000) continue;
        const impact = flow.total > 1_000_000 ? 9 : flow.total > 100_000 ? 7 : 5;
        const { error } = await supabase.from("global_signals").insert({
          title: `${flow.coo_name}: ${(flow.total / 1000).toFixed(0)}K displaced persons in returned UNHCR sample`,
          summary: `UNHCR API response for ${yearNow - 1}–${yearNow}: ${flow.refugees.toLocaleString()} refugees, ${flow.asylum.toLocaleString()} asylum seekers, and ${flow.idps.toLocaleString()} internally displaced persons associated with ${flow.coo_name}. This ranking is limited to the records returned by the API request and is not asserted to be globally exhaustive.`,
          category: "migration_displacement",
          subcategory: "refugee_flow",
          status: "developing",
          impact_score: impact,
          urgency_score: flow.total > 500_000 ? 8 : 5,
          primary_source: "UNHCR",
          source_count: 1,
          ingestion_source: "unhcr",
          first_detected_at: new Date().toISOString(),
          latest_update_at: new Date().toISOString(),
          occurred_at: new Date().toISOString(),
          affected_countries: [flow.iso3?.toUpperCase()].filter(Boolean) as string[],
          source_trust_tier: "official",
          official_source: true,
          dedup_key: `unhcr-${flow.iso3}-${yearNow}`,
        });
        if (error) {
          if (error.message.toLowerCase().includes("duplicate")) results.skipped_duplicates++;
          else throw error;
        } else {
          results.intel_events++;
        }
      }
    }, { maxRetries: 1, timeoutMs: 25_000 }).catch((error) => recordSourceError("UNHCR", error));

    // LLM-generated geopolitical claims are intentionally excluded from the
    // sensing layer. Generative models may synthesize sourced observations in
    // downstream analysis, but they are never treated as primary sensor facts.

    const totalWrites =
      results.crises +
      results.alerts +
      results.intel_events +
      results.security_incidents +
      results.critical_alerts;
    const status = results.errors.length > 0 ? "partial" : "success";

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status,
      message: `Source-grounded sensing completed: ${totalWrites} successful writes, ${results.skipped_duplicates} duplicate writes skipped, ${results.errors.length} source errors`,
    });

    await supabase.from("data_source_log").insert({
      division: "system",
      source: "live_data_aggregator",
      status,
      records_ingested: totalWrites,
      last_success: status === "success" ? new Date().toISOString() : null,
    });

    structuredLog("info", FN, "Live sensing cycle completed", {
      successful_writes: totalWrites,
      skipped_duplicates: results.skipped_duplicates,
      source_errors: results.errors.length,
    }, start);

    return new Response(JSON.stringify({
      success: results.errors.length === 0,
      status,
      results,
    }), {
      status: results.errors.length === 0 ? 200 : 207,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    structuredLog("error", FN, message, undefined, start);
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "error",
      message: message.slice(0, 500),
    });
    return new Response(JSON.stringify({ success: false, error: "Live sensing cycle failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function parseGDACSXML(xml: string): GDACSEvent[] {
  const events: GDACSEvent[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const getTag = (tag: string) => {
      const found = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(item);
      return found ? found[1].trim() : "";
    };
    const getAttr = (tag: string, attr: string) => {
      const found = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*>`).exec(item);
      return found ? found[1] : "";
    };

    events.push({
      eventtype: getAttr("gdacs:eventtype", "value") || getTag("gdacs:eventtype"),
      eventname: getTag("title") || getTag("gdacs:eventname"),
      country: getTag("gdacs:country") || "Global",
      fromdate: getTag("gdacs:fromdate") || getTag("pubDate"),
      todate: getTag("gdacs:todate") || "",
      alertlevel: getAttr("gdacs:alertlevel", "value") || getTag("gdacs:alertlevel"),
      severity: { severity: 0, severityUnit: "" },
      url: getTag("link"),
      description: getTag("description"),
    });
  }

  return events;
}

function parseWHORSS(
  xml: string,
): { title: string; description: string; link: string; pubDate: string }[] {
  const items: { title: string; description: string; link: string; pubDate: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const getTag = (tag: string) => {
      const found = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(item);
      return found
        ? found[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim()
        : "";
    };

    items.push({
      title: getTag("title"),
      description: getTag("description").slice(0, 500),
      link: getTag("link"),
      pubDate: getTag("pubDate"),
    });
  }

  return items;
}

function extractCountryFromPlace(place: string): string {
  const parts = place.split(",");
  return parts[parts.length - 1]?.trim() || "Unknown";
}
