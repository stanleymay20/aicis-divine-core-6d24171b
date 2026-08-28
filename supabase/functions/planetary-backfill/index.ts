/**
 * planetary-backfill — authenticated, truth-floor-safe planetary data worker.
 *
 * Epistemic contract:
 * - ingestion time is not observation time;
 * - provider presence is not confidence;
 * - deterministic/curated linkage is not calibrated probability;
 * - missing evidence is withheld rather than replaced with synthetic defaults.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WB_BASE = "https://api.worldbank.org/v2";

type DbClient = ReturnType<typeof createClient>;
type JsonObject = Record<string, unknown>;

type WorldBankCountry = {
  id?: string;
  name?: string;
  iso2Code?: string;
  capitalCity?: string;
  latitude?: string;
  longitude?: string;
  region?: { id?: string; value?: string };
  incomeLevel?: { value?: string };
  lendingType?: { value?: string };
};

type WorldBankMetric = {
  countryiso3code?: string;
  date?: string | number;
  value?: string | number | null;
  unit?: string;
};

type LegacySource = "performance_snapshots" | "conflict_signals" | "village_indicators" | "global_signals";

const INDICATOR_CATALOG: Record<string, string[]> = {
  finance: ["NY.GDP.MKTP.CD", "NY.GDP.MKTP.KD.ZG", "NY.GDP.PCAP.CD", "FP.CPI.TOTL.ZG"],
  trade: ["NE.EXP.GNFS.ZS", "NE.IMP.GNFS.ZS", "TX.VAL.MRCH.CD.WT", "TM.VAL.MRCH.CD.WT"],
  labor: ["SL.UEM.TOTL.ZS", "SL.TLF.CACT.ZS", "SL.AGR.EMPL.ZS", "SL.IND.EMPL.ZS"],
  demographics: ["SP.POP.TOTL", "SP.POP.GROW", "SP.DYN.LE00.IN", "SP.URB.TOTL.IN.ZS"],
  health: ["SH.XPD.CHEX.GD.ZS", "SH.MED.BEDS.ZS", "SH.MED.PHYS.ZS", "SH.TBS.INCD"],
  environment: ["EN.ATM.CO2E.PC", "AG.LND.FRST.ZS", "EG.FEC.RNEW.ZS", "AG.LND.AGRI.ZS"],
  energy: ["EG.ELC.ACCS.ZS", "EG.USE.ELEC.KH.PC", "EG.ELC.RNEW.ZS", "EG.IMP.CONS.ZS"],
  education: ["SE.PRM.ENRR", "SE.SEC.ENRR", "SE.TER.ENRR", "SE.ADT.LITR.ZS"],
  technology: ["IT.NET.USER.ZS", "IT.CEL.SETS.P2", "GB.XPD.RSDV.GD.ZS", "IP.PAT.RESD"],
  governance: ["GE.EST", "CC.EST", "RQ.EST", "RL.EST", "VA.EST", "PV.EST"],
};
const ALL_INDICATORS = Object.values(INDICATOR_CATALOG).flat();

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function inferDomain(indicator: string): string {
  for (const [domain, values] of Object.entries(INDICATOR_CATALOG)) {
    if (values.includes(indicator)) return domain;
  }
  return "unknown";
}

async function getCanonicalEntityMap(supabase: DbClient): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("canonical_entities")
    .select("id, iso3")
    .in("entity_type", ["country", "territory"])
    .not("iso3", "is", null);
  if (error) throw error;
  const result = new Map<string, string>();
  for (const row of data ?? []) {
    if (typeof row.iso3 === "string" && typeof row.id === "string") result.set(row.iso3, row.id);
  }
  return result;
}

async function seedCountries(supabase: DbClient) {
  const response = await fetch(`${WB_BASE}/country?format=json&per_page=400`);
  if (!response.ok) throw new Error(`World Bank country request failed: ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) throw new Error("Unexpected World Bank country payload");

  let seeded = 0;
  let withheld = 0;
  const errors: string[] = [];
  for (const raw of payload[1] as WorldBankCountry[]) {
    const iso3 = asString(raw.id);
    const name = asString(raw.name);
    if (!iso3 || iso3.length !== 3 || !name || raw.region?.id === "NA") {
      withheld++;
      continue;
    }
    const lat = asNumber(raw.latitude);
    const lon = asNumber(raw.longitude);
    const { error } = await supabase.from("canonical_entities").upsert({
      canonical_name: name,
      normalized_name: name.toLowerCase(),
      entity_type: "country",
      iso3,
      lat,
      lon,
      display_name: name,
      source_count: 1,
      trust_score: null,
      metadata: {
        provider: "worldbank",
        provider_fields_observed: true,
        trust_score_status: "unmeasured",
        region: raw.region?.value ?? null,
        income_level: raw.incomeLevel?.value ?? null,
        capital: raw.capitalCity ?? null,
        iso2: raw.iso2Code ?? null,
        wb_lending_type: raw.lendingType?.value ?? null,
      },
      last_resolved_at: null,
    }, { onConflict: "entity_type,normalized_name" });
    if (error) errors.push(`${iso3}: ${error.message}`); else seeded++;
  }
  return { ok: errors.length === 0, phase: "A", countries_seeded: seeded, withheld, errors: errors.slice(0, 20) };
}

async function bulkIngest(supabase: DbClient, params: JsonObject) {
  const requestedIndex = asNumber(params.indicator_index);
  let indicatorIndex: number;
  if (requestedIndex !== null) {
    indicatorIndex = Math.max(0, Math.trunc(requestedIndex));
  } else {
    const { data, error } = await supabase.from("backfill_state").select("value_int").eq("key", "wb_indicator_index").maybeSingle();
    if (error) throw error;
    indicatorIndex = typeof data?.value_int === "number" ? data.value_int : 0;
  }

  if (indicatorIndex >= ALL_INDICATORS.length) {
    return { ok: true, phase: "B", complete: true, total_indicators: ALL_INDICATORS.length };
  }

  const indicator = ALL_INDICATORS[indicatorIndex];
  const domain = inferDomain(indicator);
  const dateRange = asString(params.date_range) ?? "1960:2024";
  const entityMap = await getCanonicalEntityMap(supabase);
  const url = `${WB_BASE}/country/all/indicator/${indicator}?format=json&date=${encodeURIComponent(dateRange)}&per_page=15000`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`World Bank indicator request failed: ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) throw new Error("Unexpected World Bank metric payload");

  const rows: JsonObject[] = [];
  let withheld = 0;
  for (const raw of payload[1] as WorldBankMetric[]) {
    const iso3 = asString(raw.countryiso3code);
    const value = asNumber(raw.value);
    const period = raw.date === undefined || raw.date === null ? null : String(raw.date);
    if (!iso3 || !entityMap.has(iso3) || value === null || !period) {
      withheld++;
      continue;
    }
    const entityId = entityMap.get(iso3)!;
    const metricName = indicator.toLowerCase().replace(/\./g, "_");
    rows.push({
      provider_name: "worldbank",
      domain,
      metric_name: metricName,
      entity_id: entityId,
      iso3,
      period,
      value,
      unit: asString(raw.unit) ?? "",
      confidence: null,
      provenance_source: "worldbank",
      provenance_observed_at: null,
      dedup_key: `m:worldbank:${metricName}:${iso3}:${period}:${entityId}`,
      freshness_score: null,
      last_verified_at: null,
      metadata: {
        ingestion_status: "provider_fetch_succeeded",
        observation_time_status: "provider_period_only",
        confidence_status: "unmeasured",
        freshness_status: "unmeasured",
      },
    });
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const { error, count } = await supabase.from("normalized_metrics")
      .upsert(chunk, { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
    if (error) throw error;
    inserted += count ?? 0;
  }

  const { error: progressError } = await supabase.from("backfill_state").upsert({
    key: "wb_indicator_index",
    value_int: indicatorIndex + 1,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  if (progressError) throw progressError;

  return {
    ok: true,
    phase: "B",
    indicator,
    indicator_index: indicatorIndex,
    next_indicator_index: indicatorIndex + 1,
    records_inserted: inserted,
    withheld,
    semantics: "provider values preserved; confidence/freshness/verification withheld until measured",
  };
}

async function promoteRegions(supabase: DbClient, params: JsonObject) {
  const offset = Math.max(0, Math.trunc(asNumber(params.offset) ?? 0));
  const limit = Math.min(5000, Math.max(1, Math.trunc(asNumber(params.limit) ?? 2000)));
  const { data, error } = await supabase.from("admin_regions")
    .select("id, name, admin_level, lat, lon, country_iso3, population_est, urban_rural")
    .not("lat", "is", null).not("lon", "is", null).order("id").range(offset, offset + limit - 1);
  if (error) throw error;

  let promoted = 0;
  for (const region of data ?? []) {
    if (!region.name || !region.country_iso3) continue;
    const { error: insertError } = await supabase.from("canonical_entities").insert({
      canonical_name: `${region.name}, ${region.country_iso3}`,
      entity_type: "city",
      iso3: null,
      lat: region.lat,
      lon: region.lon,
      display_name: region.name,
      trust_score: null,
      source_count: 1,
      metadata: {
        admin_level: region.admin_level,
        country_iso3: region.country_iso3,
        population_est: region.population_est,
        urban_rural: region.urban_rural,
        admin_region_id: region.id,
        trust_score_status: "unmeasured",
      },
      last_resolved_at: null,
    });
    if (!insertError) promoted++;
  }

  await supabase.from("backfill_state").upsert({
    key: "region_offset", value_int: offset + limit, updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  return { ok: true, phase: "D", offset, limit, promoted, next_offset: offset + limit, has_more: (data?.length ?? 0) === limit };
}

async function seedEntities(supabase: DbClient, params: JsonObject) {
  const entityClass = asString(params.entity_class) ?? "all";
  const entities = [
    { name: "United Nations", type: "company", category: "international_org" },
    { name: "World Bank", type: "company", category: "international_org" },
    { name: "International Monetary Fund", type: "company", category: "international_org" },
    { name: "World Health Organization", type: "company", category: "international_org" },
    { name: "African Union", type: "company", category: "regional_org" },
    { name: "European Union", type: "company", category: "regional_org" },
    { name: "Crude Oil", type: "commodity", category: "commodity" },
    { name: "Natural Gas", type: "commodity", category: "commodity" },
    { name: "Gold", type: "commodity", category: "commodity" },
    { name: "Wheat", type: "commodity", category: "commodity" },
    { name: "Agriculture", type: "sector", category: "sector" },
    { name: "Energy", type: "sector", category: "sector" },
    { name: "Financial Services", type: "sector", category: "sector" },
    { name: "Healthcare", type: "sector", category: "sector" },
  ];

  let created = 0;
  for (const entity of entities) {
    const matchesClass = entityClass === "all"
      || (entityClass === "organizations" && entity.type === "company")
      || (entityClass === "commodities" && entity.type === "commodity")
      || (entityClass === "sectors" && entity.type === "sector");
    if (!matchesClass) continue;
    const { error } = await supabase.from("canonical_entities").insert({
      canonical_name: entity.name,
      normalized_name: entity.name.toLowerCase(),
      entity_type: entity.type,
      display_name: entity.name,
      trust_score: null,
      source_count: 1,
      metadata: { category: entity.category, provenance: "curated_seed", trust_score_status: "unmeasured" },
      last_resolved_at: null,
    });
    if (!error) created++;
  }
  return { ok: true, phase: "D2", entities_created: created, semantics: "curated identity seed; no calibrated trust score assigned" };
}

async function generateLinks(supabase: DbClient, params: JsonObject) {
  const limit = Math.min(5000, Math.max(1, Math.trunc(asNumber(params.limit) ?? 2000)));
  const { data, error } = await supabase.from("normalized_metrics")
    .select("id, entity_id").not("entity_id", "is", null).limit(limit);
  if (error) throw error;
  const rows = (data ?? []).filter((row) => row.entity_id).map((row) => ({
    metric_id: row.id,
    entity_id: row.entity_id,
    link_role: "primary_entity",
    confidence: null,
  }));
  if (rows.length > 0) {
    const { error: upsertError } = await supabase.from("entity_metric_links")
      .upsert(rows, { onConflict: "metric_id,entity_id,link_role", ignoreDuplicates: true });
    if (upsertError) throw upsertError;
  }
  return {
    ok: true,
    phase: "4",
    links_created_or_existing: rows.length,
    semantics: "deterministic foreign-key association; confidence withheld because no calibration evidence exists",
  };
}

async function unifyLegacy(supabase: DbClient, params: JsonObject) {
  const source = asString(params.source) as LegacySource | null;
  const offset = Math.max(0, Math.trunc(asNumber(params.offset) ?? 0));
  const limit = Math.min(1000, Math.max(1, Math.trunc(asNumber(params.limit) ?? 1000)));
  if (!source || !["performance_snapshots", "conflict_signals", "village_indicators", "global_signals"].includes(source)) {
    return { ok: false, phase: "6", error: "Unsupported legacy source" };
  }

  const entityMap = await getCanonicalEntityMap(supabase);
  const { data, error } = await supabase.from(source === "performance_snapshots" ? "country_performance_snapshots" : source)
    .select("*").order("id").range(offset, offset + limit - 1);
  if (error) throw error;

  let migrated = 0;
  let withheld = 0;
  if (source === "conflict_signals") {
    const rows: JsonObject[] = [];
    for (const raw of data ?? []) {
      const row = asObject(raw);
      const iso3 = asString(row.country_iso3);
      const startedAt = asIsoTimestamp(row.created_at);
      if (!iso3 || !startedAt) { withheld++; continue; }
      rows.push({
        provider_name: "aicis_legacy",
        event_type: asString(row.conflict_type) ?? "conflict",
        title: `Conflict signal: ${asString(row.region) ?? iso3}`,
        description: asString(row.assessment_md) ?? "",
        entity_id: entityMap.get(iso3) ?? null,
        iso3,
        started_at: startedAt,
        severity: asNumber(row.conflict_intensity) === null ? null : Math.round(asNumber(row.conflict_intensity)! * 10),
        confidence: asNumber(row.confidence),
        provenance_source: "conflict_signals",
        dedup_key: `e:aicis_legacy:conflict:${iso3}:${asString(row.region) ?? "unknown"}:${startedAt}`,
        freshness_score: null,
        last_verified_at: asIsoTimestamp(row.updated_at),
        metadata: { legacy_semantics: "preserved_without_fallbacks", calibrated_probability: null },
      });
    }
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("normalized_events").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
      if (insertError) throw insertError;
      migrated = rows.length;
    }
  } else if (source === "global_signals") {
    const rows: JsonObject[] = [];
    for (const raw of data ?? []) {
      const row = asObject(raw);
      const startedAt = asIsoTimestamp(row.detected_at) ?? asIsoTimestamp(row.created_at);
      if (!startedAt) { withheld++; continue; }
      const regions = Array.isArray(row.affected_regions) ? row.affected_regions : [];
      const iso3 = asString(regions[0]);
      rows.push({
        provider_name: "aicis_signals",
        event_type: asString(row.category) ?? "signal",
        title: asString(row.title) ?? asString(row.headline) ?? "Signal",
        description: asString(row.summary) ?? "",
        entity_id: iso3 ? entityMap.get(iso3) ?? null : null,
        iso3,
        started_at: startedAt,
        severity: asNumber(row.impact_score),
        confidence: asNumber(row.confidence_score),
        provenance_source: "global_signals",
        dedup_key: `e:signals:${String(row.id ?? startedAt)}`,
        freshness_score: null,
        last_verified_at: null,
        metadata: { legacy_semantics: "preserved_without_fallbacks", calibrated_probability: null },
      });
    }
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("normalized_events").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
      if (insertError) throw insertError;
      migrated = rows.length;
    }
  } else {
    // These legacy metric sources contain heterogeneous period/confidence semantics.
    // Until a governed field mapping exists, preserving them as normalized facts would
    // overstate certainty. Keep source rows untouched and report them as withheld.
    withheld = data?.length ?? 0;
  }

  return {
    ok: true,
    phase: "6",
    source,
    offset,
    migrated,
    withheld,
    next_offset: offset + limit,
    has_more: (data?.length ?? 0) === limit,
    semantics: "no confidence, freshness, verification, or event-time fallback values are manufactured",
  };
}

async function getStatus(supabase: DbClient) {
  const [entities, countries, metrics, events, links] = await Promise.all([
    supabase.from("canonical_entities").select("*", { count: "exact", head: true }),
    supabase.from("canonical_entities").select("*", { count: "exact", head: true }).in("entity_type", ["country", "territory"]),
    supabase.from("normalized_metrics").select("*", { count: "exact", head: true }),
    supabase.from("normalized_events").select("*", { count: "exact", head: true }),
    supabase.from("entity_metric_links").select("*", { count: "exact", head: true }),
  ]);
  return {
    ok: true,
    totals: {
      entities: entities.count ?? 0,
      countries_territories: countries.count ?? 0,
      metrics: metrics.count ?? 0,
      events: events.count ?? 0,
      metric_links: links.count ?? 0,
    },
    status_semantics: "observed database counts only; no readiness percentage implied",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let action: string | undefined;
  try {
    const body = asObject(await req.json().catch(() => ({})));
    action = asString(body.action) ?? undefined;
    const params = { ...body };
    delete params.action;

    let result: unknown;
    switch (action) {
      case "seed_countries": result = await seedCountries(supabase); break;
      case "bulk_ingest": result = await bulkIngest(supabase, params); break;
      case "promote_regions": result = await promoteRegions(supabase, params); break;
      case "seed_entities": result = await seedEntities(supabase, params); break;
      case "generate_links": result = await generateLinks(supabase, params); break;
      case "unify_legacy": result = await unifyLegacy(supabase, params); break;
      case "status": result = await getStatus(supabase); break;
      default: return jsonRes({ error: `Unknown action: ${action ?? "missing"}` }, 400);
    }

    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "planetary-backfill",
      _success: true,
      _metadata: { action, epistemic_contract: "truth_floor_v1" },
    });
    return jsonRes(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "planetary-backfill",
      _success: false,
      _error: message,
      _metadata: { action, epistemic_contract: "truth_floor_v1" },
    });
    return jsonRes({ error: message }, 500);
  }
});
