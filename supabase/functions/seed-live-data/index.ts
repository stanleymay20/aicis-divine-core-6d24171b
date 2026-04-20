import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "seed-live-data";

// Define interfaces for data structures
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

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const results = { crises: 0, alerts: 0, intel_events: 0, security_incidents: 0, critical_alerts: 0, errors: [] as string[] };

  try {
    structuredLog('info', FN, 'Starting live data population');

    // 1. NASA EONET
    await resilientCall(`${FN}:eonet`, async () => {
      const resp = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50");
      if (!resp.ok) throw new Error(`EONET: ${resp.status}`);
      const data = await resp.json();
      const events: EONETEvent[] = data.events || [];

      for (const event of events) {
        const severity = event.categories[0]?.id === "wildfires" ? 8 : event.categories[0]?.id === "severeStorms" ? 7 : 5;
        const { error: crisisError } = await supabase.from("crisis_events").upsert({
          id: `eonet-${event.id}`, kind: event.categories[0]?.title || "Natural Event",
          region: event.title.split(" - ")[0] || "Global", severity, status: "monitoring",
          details_md: `## ${event.title}\n\n${event.description || "Active natural event detected by NASA EONET."}`,
          opened_at: event.geometry[0]?.date || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
        if (!crisisError) results.crises++;

        await supabase.from("intel_events").insert({
          division: "crisis", event_type: "natural_disaster",
          severity: severity >= 7 ? "critical" : "warning",
          title: event.title, description: event.description || `${event.categories[0]?.title} event`,
          payload: { source: "NASA_EONET", event_id: event.id, category: event.categories[0]?.title },
          source_system: "NASA EONET",
        });
        results.intel_events++;
      }
    }, { maxRetries: 1, timeoutMs: 20000 }).catch(e => results.errors.push(`EONET: ${(e as Error).message}`));

    // 2. GDACS
    await resilientCall(`${FN}:gdacs`, async () => {
      const resp = await fetch("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?limit=30&orderby=severity:desc");
      if (!resp.ok) throw new Error(`GDACS: ${resp.status}`);
      const text = await resp.text();
      const events = parseGDACSXML(text);

      for (const event of events) {
        const severityMap: Record<string, number> = { "Red": 9, "Orange": 7, "Green": 4 };
        const severity = severityMap[event.alertlevel] || 5;
        const { error } = await supabase.from("critical_alerts").upsert({
          id: `gdacs-${event.eventtype}-${event.fromdate}`, headline: event.eventname,
          level: event.alertlevel?.toLowerCase() || "warning", severity, country: event.country,
          event_type: event.eventtype, meta: { source: "GDACS", url: event.url },
          triggered_at: event.fromdate,
        }, { onConflict: "id" });
        if (!error) results.critical_alerts++;
      }
    }, { maxRetries: 1, timeoutMs: 15000 }).catch(e => results.errors.push(`GDACS: ${(e as Error).message}`));

    // 3. ReliefWeb
    await resilientCall(`${FN}:reliefweb`, async () => {
      const resp = await fetch("https://api.reliefweb.int/v1/disasters?appname=aicis&limit=30&preset=latest&fields[include][]=name&fields[include][]=status&fields[include][]=date&fields[include][]=country&fields[include][]=type&fields[include][]=primary_type");
      if (!resp.ok) throw new Error(`ReliefWeb: ${resp.status}`);
      const data = await resp.json();
      const disasters: ReliefWebDisaster[] = data.data || [];

      for (const disaster of disasters) {
        const country = disaster.fields.country?.[0]?.name || "Global";
        const iso3 = disaster.fields.country?.[0]?.iso3;
        const type = disaster.fields.primary_type?.name || disaster.fields.type?.[0]?.name || "Disaster";

        const { error: alertError } = await supabase.from("alerts").insert({
          title: disaster.fields.name, message: `${type} affecting ${country}. Status: ${disaster.fields.status}`,
          severity: disaster.fields.status === "ongoing" ? "critical" : "high",
          division: "crisis", country, metadata: { source: "ReliefWeb", disaster_id: disaster.id, iso3, type },
        });
        if (!alertError) results.alerts++;

        if (disaster.fields.status === "ongoing") {
          const { error: secError } = await supabase.from("security_incidents").insert({
            event_type: "humanitarian_crisis", severity: 7, title: disaster.fields.name,
            summary: `${type} affecting ${country}`, country, iso3, source: "ReliefWeb",
            start_time: disaster.fields.date?.original || new Date().toISOString(),
            raw: { disaster_id: disaster.id, type },
          });
          if (!secError) results.security_incidents++;
        }
      }
    }, { maxRetries: 1, timeoutMs: 15000 }).catch(e => results.errors.push(`ReliefWeb: ${(e as Error).message}`));

    // 4. WHO Disease Outbreaks
    await resilientCall(`${FN}:who`, async () => {
      const resp = await fetch("https://www.who.int/feeds/entity/csr/don/en/rss.xml");
      if (!resp.ok) throw new Error(`WHO: ${resp.status}`);
      const text = await resp.text();
      const outbreaks = parseWHORSS(text);

      for (const outbreak of outbreaks.slice(0, 20)) {
        const { error } = await supabase.from("intel_events").insert({
          division: "health", event_type: "disease_outbreak",
          severity: outbreak.title.toLowerCase().includes("ebola") || outbreak.title.toLowerCase().includes("cholera") ? "critical" : "warning",
          title: outbreak.title, description: outbreak.description,
          payload: { source: "WHO", link: outbreak.link, pubDate: outbreak.pubDate },
          source_system: "WHO DON",
        });
        if (error) { results.errors.push(`insert: ${error.message}`); } else { results.intel_events++; }
      }
    }, { maxRetries: 1, timeoutMs: 15000 }).catch(e => results.errors.push(`WHO: ${(e as Error).message}`));

    // 5. USGS Earthquakes
    await resilientCall(`${FN}:usgs`, async () => {
      const resp = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson");
      if (!resp.ok) throw new Error(`USGS: ${resp.status}`);
      const data = await resp.json();
      const quakes = data.features || [];

      for (const quake of quakes) {
        const mag = quake.properties.mag;
        const place = quake.properties.place;
        const coords = quake.geometry.coordinates;

        const { error: crisisError } = await supabase.from("crisis_events").upsert({
          id: `usgs-${quake.id}`, kind: "Earthquake", region: place,
          severity: Math.min(Math.round(mag), 10), status: "monitoring",
          details_md: `## Magnitude ${mag} Earthquake\n\n**Location:** ${place}\n**Depth:** ${coords[2]} km`,
          opened_at: new Date(quake.properties.time).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
        if (!crisisError) results.crises++;

        if (mag >= 5.5) {
          const { error: alertError } = await supabase.from("alerts").insert({
            title: `M${mag} Earthquake: ${place}`,
            message: `Significant seismic activity. Magnitude ${mag} at depth ${coords[2]}km.`,
            severity: mag >= 7 ? "critical" : "high", division: "crisis",
            country: extractCountryFromPlace(place),
            metadata: { source: "USGS", quake_id: quake.id, magnitude: mag, depth: coords[2] },
          });
          if (!alertError) results.alerts++;
        }
      }
    }, { maxRetries: 1, timeoutMs: 15000 }).catch(e => results.errors.push(`USGS: ${(e as Error).message}`));

    // 6. NVD Vulnerabilities
    await resilientCall(`${FN}:nvd`, async () => {
      const nvdKey = Deno.env.get("NVD_API_KEY");
      const nvdUrl = nvdKey
        ? `https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=20&cvssV3Severity=CRITICAL`
        : `https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=10`;
      const resp = await fetch(nvdUrl, { headers: nvdKey ? { "apiKey": nvdKey } : {} });
      if (!resp.ok) throw new Error(`NVD: ${resp.status}`);
      const data = await resp.json();

      for (const vuln of (data.vulnerabilities || []).slice(0, 10)) {
        const cve = vuln.cve;
        const cvss = cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore || cve.metrics?.cvssMetricV30?.[0]?.cvssData?.baseScore || 7;
        const { error } = await supabase.from("security_incidents").insert({
          event_type: "vulnerability", severity: cvss, title: cve.id,
          summary: cve.descriptions?.[0]?.value?.slice(0, 500) || "Critical vulnerability",
          source: "NVD", raw: { cve_id: cve.id, cvss_score: cvss, published: cve.published },
        });
        if (!error) results.security_incidents++;
      }
    }, { maxRetries: 1, timeoutMs: 20000 }).catch(e => results.errors.push(`NVD: ${(e as Error).message}`));

    // 7. FAO GIEWS — Food security & crop monitoring (ReliefWeb-mediated; FAO doesn't expose direct API)
    await resilientCall(`${FN}:fao-giews`, async () => {
      // ReliefWeb disasters tagged with food-security / drought (FAO/GIEWS-equivalent)
      const resp = await fetch("https://api.reliefweb.int/v1/disasters?appname=aicis&limit=20&filter[field]=primary_type.code&filter[value][]=DR&filter[value][]=FA&fields[include][]=name&fields[include][]=description&fields[include][]=date&fields[include][]=country&fields[include][]=primary_type&fields[include][]=status&sort[]=date.created:desc");
      if (!resp.ok) throw new Error(`FAO/GIEWS: ${resp.status}`);
      const data = await resp.json();
      const reports = data.data || [];

      for (const r of reports.slice(0, 15)) {
        const country = r.fields.country?.[0]?.name || "Global";
        const iso3 = r.fields.country?.[0]?.iso3?.toUpperCase() || null;
        const title = (r.fields.name || "Food security / drought update").slice(0, 240);
        const body = (r.fields.description || `${r.fields.primary_type?.name || "Drought/Food crisis"} affecting ${country}. Status: ${r.fields.status || "monitoring"}.`).slice(0, 800);

        const { error } = await supabase.from("global_signals").insert({
          title,
          summary: body,
          category: "food_agriculture",
          subcategory: "food_security",
          status: "developing",
          confidence_score: 85,
          impact_score: title.toLowerCase().match(/(famine|crisis|emergency|ipc\s*[45])/) ? 8 : 5,
          urgency_score: 6,
          primary_source: "FAO/GIEWS via ReliefWeb",
          source_count: 1,
          ingestion_source: "fao_giews",
          first_detected_at: r.fields.date?.created || new Date().toISOString(),
          latest_update_at: new Date().toISOString(),
          occurred_at: r.fields.date?.original || new Date().toISOString(),
          affected_countries: iso3 ? [iso3] : [],
          source_trust_tier: "official",
          official_source: true,
          dedup_key: `fao-giews-${r.id}`,
        });
        if (error) { results.errors.push(`fao_insert: ${error.message}`); } else { results.intel_events++; }
      }
    }, { maxRetries: 1, timeoutMs: 20000 }).catch(e => results.errors.push(`FAO/GIEWS: ${(e as Error).message}`));

    // 8. USGS WaterWatch — Streamflow & drought conditions
    await resilientCall(`${FN}:usgs-water`, async () => {
      // USGS Water Services: current streamflow conditions, focus on drought (low flow) sites
      const resp = await fetch("https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd=ca&parameterCd=00060&siteStatus=active");
      if (!resp.ok) throw new Error(`USGS Water: ${resp.status}`);
      const data = await resp.json();
      const series = data.value?.timeSeries || [];

      // Aggregate by state into one signal per anomaly cluster
      const stateAnomalies: Record<string, { low: number; total: number; sites: string[] }> = {};
      for (const ts of series.slice(0, 200)) {
        const siteName = ts.sourceInfo?.siteName || "";
        const stateCode = ts.sourceInfo?.siteCode?.[0]?.value?.slice(0, 2) || "??";
        const value = parseFloat(ts.values?.[0]?.value?.[0]?.value || "0");
        if (!stateAnomalies[stateCode]) stateAnomalies[stateCode] = { low: 0, total: 0, sites: [] };
        stateAnomalies[stateCode].total++;
        if (value < 10) {
          stateAnomalies[stateCode].low++;
          if (stateAnomalies[stateCode].sites.length < 3) stateAnomalies[stateCode].sites.push(siteName);
        }
      }

      for (const [state, stats] of Object.entries(stateAnomalies)) {
        if (stats.total < 3) continue;
        const lowPct = (stats.low / stats.total) * 100;
        const severity = lowPct > 50 ? 8 : lowPct > 25 ? 6 : 4;
        const title = `USGS Streamflow Anomaly — ${stats.low}/${stats.total} sites below normal`;

        const { error } = await supabase.from("global_signals").insert({
          title,
          summary: `Hydrological monitoring shows ${lowPct.toFixed(0)}% of monitored streamflow sites in region ${state} below normal flow. Sample sites: ${stats.sites.join("; ")}.`,
          category: "water_hydrology",
          subcategory: "streamflow_drought",
          status: "developing",
          confidence_score: 90,
          impact_score: severity,
          urgency_score: lowPct > 50 ? 7 : 4,
          primary_source: "USGS Water Services",
          source_count: stats.total,
          ingestion_source: "usgs_waterwatch",
          first_detected_at: new Date().toISOString(),
          latest_update_at: new Date().toISOString(),
          occurred_at: new Date().toISOString(),
          affected_countries: ["USA"],
          source_trust_tier: "official",
          official_source: true,
          dedup_key: `usgs-water-${state}-${new Date().toISOString().split("T")[0]}`,
        });
        if (error) { results.errors.push(`insert: ${error.message}`); } else { results.intel_events++; }
      }
    }, { maxRetries: 1, timeoutMs: 25000 }).catch(e => results.errors.push(`USGS Water: ${(e as Error).message}`));

    // 9. UNHCR — Refugee & displacement movements
    await resilientCall(`${FN}:unhcr`, async () => {
      // UNHCR Refugee Population Statistics public API
      const yearNow = new Date().getFullYear();
      const resp = await fetch(`https://api.unhcr.org/population/v1/population/?yearFrom=${yearNow - 1}&yearTo=${yearNow}&coo_all=true&limit=30`);
      if (!resp.ok) throw new Error(`UNHCR: ${resp.status}`);
      const data = await resp.json();
      const items = data.items || [];

      // Group by origin country and surface major flows
      const flows: Record<string, { refugees: number; asylum: number; idps: number; coo_name: string }> = {};
      for (const item of items) {
        const coo = item.coo_iso || item.coo;
        if (!coo) continue;
        if (!flows[coo]) flows[coo] = { refugees: 0, asylum: 0, idps: 0, coo_name: item.coo_name || coo };
        flows[coo].refugees += parseInt(item.refugees || "0");
        flows[coo].asylum += parseInt(item.asylum_seekers || "0");
        flows[coo].idps += parseInt(item.idps || "0");
      }

      const topFlows = Object.entries(flows)
        .map(([iso3, f]) => ({ iso3, ...f, total: f.refugees + f.asylum + f.idps }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      for (const flow of topFlows) {
        if (flow.total < 1000) continue;
        const severity = flow.total > 1_000_000 ? 9 : flow.total > 100_000 ? 7 : 5;
        const title = `${flow.coo_name}: ${(flow.total / 1000).toFixed(0)}K displaced persons tracked`;

        const { error } = await supabase.from("global_signals").insert({
          title,
          summary: `UNHCR latest data: ${flow.refugees.toLocaleString()} refugees, ${flow.asylum.toLocaleString()} asylum seekers, ${flow.idps.toLocaleString()} internally displaced from ${flow.coo_name}.`,
          category: "migration_displacement",
          subcategory: "refugee_flow",
          status: "developing",
          confidence_score: 0.95,
          impact_score: severity,
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
        if (error) { results.errors.push(`insert: ${error.message}`); } else { results.intel_events++; }
      }
    }, { maxRetries: 1, timeoutMs: 25000 }).catch(e => results.errors.push(`UNHCR: ${(e as Error).message}`));

    // 10. AI Geopolitical
    await resilientCall(`${FN}:ai-diplo`, async () => {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) throw new Error("No LOVABLE_API_KEY");
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{
            role: "system", content: "You are a geopolitical analyst. Provide 5 current real-world diplomatic developments. Return JSON array with: title, country, severity (info/warning/critical), description."
          }, {
            role: "user", content: `Current date: ${new Date().toISOString().split("T")[0]}. List 5 significant current geopolitical events.`
          }],
          response_format: { type: "json_object" },
        }),
      });
      if (!aiResponse.ok) throw new Error(`AI: ${aiResponse.status}`);
      const aiData = await aiResponse.json();
      const parsed = JSON.parse(aiData.choices[0]?.message?.content);
      const events = parsed.events || parsed.developments || [];

      for (const event of events) {
        const { error } = await supabase.from("intel_events").insert({
          division: "diplomacy", event_type: "geopolitical",
          severity: event.severity || "info", title: event.title,
          description: event.description,
          payload: { source: "AI_Analysis", country: event.country },
          source_system: "AICIS Intelligence",
        });
        if (error) { results.errors.push(`insert: ${error.message}`); } else { results.intel_events++; }
      }
    }, { maxRetries: 1, timeoutMs: 25000 }).catch(e => results.errors.push(`AI Diplomacy: ${(e as Error).message}`));

    // Log
    const total = results.crises + results.alerts + results.intel_events + results.security_incidents + results.critical_alerts;
    await supabase.from("automation_logs").insert({
      job_name: FN, status: results.errors.length > 0 ? "partial" : "success",
      message: `Populated: ${total} records (${results.errors.length} source errors)`,
    });

    await supabase.from("data_source_log").insert({
      division: "system", source: "live_data_aggregator", status: "success",
      records_ingested: total, last_success: new Date().toISOString(),
    });

    structuredLog('info', FN, `Populated ${total} records`, { errors: results.errors.length }, start);
    return jsonResponse({ success: true, message: "Live data populated", results });
  } catch (e) {
    structuredLog('error', FN, (e as Error).message, undefined, start);
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: (e as Error).message });
    return errorResponse(e);
  }
});

function parseGDACSXML(xml: string): GDACSEvent[] {
  const events: GDACSEvent[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const getTag = (tag: string) => { const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(item); return m ? m[1].trim() : ""; };
    const getAttr = (tag: string, attr: string) => { const m = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*>`).exec(item); return m ? m[1] : ""; };
    events.push({
      eventtype: getAttr("gdacs:eventtype", "value") || getTag("gdacs:eventtype"),
      eventname: getTag("title") || getTag("gdacs:eventname"),
      country: getTag("gdacs:country") || "Global",
      fromdate: getTag("gdacs:fromdate") || getTag("pubDate"),
      todate: getTag("gdacs:todate") || "",
      alertlevel: getAttr("gdacs:alertlevel", "value") || getTag("gdacs:alertlevel"),
      severity: { severity: 0, severityUnit: "" }, url: getTag("link"), description: getTag("description"),
    });
  }
  return events;
}

function parseWHORSS(xml: string): { title: string; description: string; link: string; pubDate: string }[] {
  const items: { title: string; description: string; link: string; pubDate: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const getTag = (tag: string) => { const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(item); return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : ""; };
    items.push({ title: getTag("title"), description: getTag("description").slice(0, 500), link: getTag("link"), pubDate: getTag("pubDate") });
  }
  return items;
}

function extractCountryFromPlace(place: string): string {
  const parts = place.split(",");
  return parts[parts.length - 1]?.trim() || "Unknown";
}
