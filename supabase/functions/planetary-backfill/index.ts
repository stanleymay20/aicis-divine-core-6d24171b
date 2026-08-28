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
type SeedEntity = { name: string; type: "company" | "commodity" | "sector"; category: string; iso3?: string };

const INDICATOR_CATALOG: Record<string, string[]> = {
  finance: [
    "NY.GDP.MKTP.CD", "NY.GDP.MKTP.KD.ZG", "NY.GDP.PCAP.CD", "NY.GDP.PCAP.KD.ZG",
    "FP.CPI.TOTL.ZG", "BN.CAB.XOKA.GD.ZS", "GC.DOD.TOTL.GD.ZS", "GC.REV.XGRT.GD.ZS",
    "GC.XPN.TOTL.GD.ZS", "GC.BAL.CASH.GD.ZS", "BX.KLT.DINV.WD.GD.ZS", "FM.LBL.BMNY.GD.ZS",
    "BX.TRF.PWKR.DT.GD.ZS", "PA.NUS.FCRF", "FR.INR.RINR", "CM.MKT.LCAP.GD.ZS",
    "FS.AST.DOMS.GD.ZS", "FB.CBK.BRWR.P3", "DT.DOD.DECT.GN.ZS", "DT.TDS.DECT.GN.ZS",
  ],
  trade: [
    "NE.EXP.GNFS.ZS", "NE.IMP.GNFS.ZS", "TG.VAL.TOTL.GD.ZS", "BG.GSR.NFSV.GD.ZS",
    "TX.VAL.MRCH.CD.WT", "TM.VAL.MRCH.CD.WT", "IC.EXP.DURS", "IC.IMP.DURS",
    "IC.EXP.COST.CD", "IC.IMP.COST.CD", "TM.TAX.MRCH.WM.AR.ZS", "LP.LPI.OVRL.XQ",
  ],
  labor: [
    "SL.UEM.TOTL.ZS", "SL.UEM.TOTL.FE.ZS", "SL.UEM.TOTL.MA.ZS", "SL.UEM.1524.ZS",
    "SL.TLF.CACT.ZS", "SL.TLF.CACT.FE.ZS", "SL.AGR.EMPL.ZS", "SL.IND.EMPL.ZS",
    "SL.SRV.EMPL.ZS", "SL.TLF.TOTL.IN", "SL.GDP.PCAP.EM.KD",
  ],
  demographics: [
    "SP.POP.TOTL", "SP.POP.GROW", "SP.DYN.LE00.IN", "SP.DYN.LE00.FE.IN",
    "SP.DYN.LE00.MA.IN", "SP.DYN.CBRT.IN", "SP.DYN.CDRT.IN", "SP.DYN.TFRT.IN",
    "SP.URB.TOTL.IN.ZS", "SP.RUR.TOTL.ZS", "SP.POP.DPND", "SP.POP.65UP.TO.ZS",
    "SP.POP.0014.TO.ZS", "SM.POP.NETM", "SP.DYN.IMRT.IN",
  ],
  health: [
    "SH.XPD.CHEX.GD.ZS", "SH.XPD.CHEX.PC.CD", "SH.MED.BEDS.ZS", "SH.MED.PHYS.ZS",
    "SH.IMM.IDPT", "SH.IMM.MEAS", "SH.STA.MMRT", "SH.DYN.MORT",
    "SH.STA.STNT.ZS", "SH.STA.WASH.P5", "SH.HIV.INCD.TL.P3", "SH.TBS.INCD",
    "SH.STA.SUIC.P5", "SH.ALC.PCAP.LI",
  ],
  environment: [
    "EN.ATM.CO2E.PC", "EN.ATM.CO2E.KT", "EN.ATM.GHGT.KT.CE", "EN.ATM.PM25.MC.M3",
    "AG.LND.FRST.ZS", "AG.LND.FRST.K2", "ER.H2O.FWST.ZS", "ER.H2O.FWTL.ZS",
    "EG.FEC.RNEW.ZS", "EN.CLC.MDAT.ZS", "AG.LND.ARBL.ZS", "AG.LND.AGRI.ZS",
  ],
  energy: [
    "EG.ELC.ACCS.ZS", "EG.ELC.ACCS.RU.ZS", "EG.ELC.ACCS.UR.ZS",
    "EG.USE.PCAP.KG.OE", "EG.USE.ELEC.KH.PC", "EG.ELC.RNEW.ZS",
    "EG.ELC.PETR.ZS", "EG.ELC.NUCL.ZS", "EG.ELC.HYRO.ZS", "EG.ELC.COAL.ZS",
    "EG.USE.COMM.FO.ZS", "EG.IMP.CONS.ZS",
  ],
  education: [
    "SE.PRM.ENRR", "SE.SEC.ENRR", "SE.TER.ENRR", "SE.ADT.LITR.ZS",
    "SE.ADT.LITR.FE.ZS", "SE.XPD.TOTL.GD.ZS", "SE.PRM.CMPT.ZS",
    "SE.SEC.CMPT.LO.ZS", "SE.PRM.TCHR", "SE.SEC.TCHR", "SE.PRM.UNER",
  ],
  technology: [
    "IT.NET.USER.ZS", "IT.CEL.SETS.P2", "IT.NET.BBND.P2", "IT.NET.SECR.P6",
    "GB.XPD.RSDV.GD.ZS", "IP.PAT.RESD", "IP.PAT.NRES", "IP.TMK.TOTL",
    "TX.VAL.TECH.CD", "TX.VAL.TECH.MF.ZS",
  ],
  governance: [
    "GE.EST", "CC.EST", "RQ.EST", "RL.EST", "VA.EST", "PV.EST",
    "IQ.CPA.GNDR.XQ", "IQ.CPA.TRAN.XQ", "IC.REG.DURS", "IC.REG.PROC",
    "IC.BUS.NREG", "IC.TAX.TOTL.CP.ZS",
  ],
  inequality: [
    "SI.POV.GINI", "SI.POV.DDAY", "SI.POV.NAHC", "SI.POV.GAPS",
    "SI.DST.10TH.10", "SI.DST.FRST.10", "SI.DST.05TH.20", "SI.DST.FRST.20",
  ],
  food: [
    "AG.PRD.FOOD.XD", "AG.YLD.CREL.KG", "AG.PRD.CREL.MT", "AG.CON.FERT.ZS",
    "SN.ITK.DEFC.ZS", "SN.ITK.DPTH", "AG.LND.IRIG.AG.ZS", "AG.LND.TRAC.ZS",
  ],
};
const ALL_INDICATORS = Object.values(INDICATOR_CATALOG).flat();

const SEEDED_ENTITIES: SeedEntity[] = [
  { name: "United Nations", type: "company", category: "international_org" },
  { name: "World Bank", type: "company", category: "international_org" },
  { name: "International Monetary Fund", type: "company", category: "international_org" },
  { name: "World Trade Organization", type: "company", category: "international_org" },
  { name: "World Health Organization", type: "company", category: "international_org" },
  { name: "International Labour Organization", type: "company", category: "international_org" },
  { name: "Food and Agriculture Organization", type: "company", category: "international_org" },
  { name: "UNESCO", type: "company", category: "international_org" },
  { name: "UNICEF", type: "company", category: "international_org" },
  { name: "UNHCR", type: "company", category: "international_org" },
  { name: "International Atomic Energy Agency", type: "company", category: "international_org" },
  { name: "Organization of the Petroleum Exporting Countries", type: "company", category: "international_org" },
  { name: "African Union", type: "company", category: "regional_org" },
  { name: "European Union", type: "company", category: "regional_org" },
  { name: "Association of Southeast Asian Nations", type: "company", category: "regional_org" },
  { name: "North Atlantic Treaty Organization", type: "company", category: "regional_org" },
  { name: "European Central Bank", type: "company", category: "central_bank" },
  { name: "Federal Reserve System", type: "company", category: "central_bank" },
  { name: "Bank of England", type: "company", category: "central_bank" },
  { name: "Bank of Japan", type: "company", category: "central_bank" },
  { name: "People's Bank of China", type: "company", category: "central_bank" },
  { name: "Reserve Bank of India", type: "company", category: "central_bank" },
  { name: "International Red Cross", type: "company", category: "ngo" },
  { name: "Médecins Sans Frontières", type: "company", category: "ngo" },
  { name: "Amnesty International", type: "company", category: "ngo" },
  { name: "Transparency International", type: "company", category: "ngo" },
  { name: "Oxfam International", type: "company", category: "ngo" },
  { name: "Greenpeace International", type: "company", category: "ngo" },
  { name: "Apple Inc.", type: "company", category: "tech", iso3: "USA" },
  { name: "Microsoft Corporation", type: "company", category: "tech", iso3: "USA" },
  { name: "Amazon.com Inc.", type: "company", category: "tech", iso3: "USA" },
  { name: "Alphabet Inc.", type: "company", category: "tech", iso3: "USA" },
  { name: "Saudi Aramco", type: "company", category: "energy", iso3: "SAU" },
  { name: "Walmart Inc.", type: "company", category: "retail", iso3: "USA" },
  { name: "ExxonMobil", type: "company", category: "energy", iso3: "USA" },
  { name: "Berkshire Hathaway", type: "company", category: "finance", iso3: "USA" },
  { name: "NVIDIA Corporation", type: "company", category: "tech", iso3: "USA" },
  { name: "Johnson & Johnson", type: "company", category: "pharma", iso3: "USA" },
  { name: "JPMorgan Chase", type: "company", category: "finance", iso3: "USA" },
  { name: "Samsung Electronics", type: "company", category: "tech", iso3: "KOR" },
  { name: "Toyota Motor Corporation", type: "company", category: "automotive", iso3: "JPN" },
  { name: "Tencent Holdings", type: "company", category: "tech", iso3: "CHN" },
  { name: "Shell plc", type: "company", category: "energy", iso3: "GBR" },
  { name: "Nestlé", type: "company", category: "food", iso3: "CHE" },
  { name: "Roche Holding", type: "company", category: "pharma", iso3: "CHE" },
  { name: "LVMH", type: "company", category: "luxury", iso3: "FRA" },
  { name: "HSBC Holdings", type: "company", category: "finance", iso3: "GBR" },
  { name: "Siemens AG", type: "company", category: "industrial", iso3: "DEU" },
  { name: "BHP Group", type: "company", category: "mining", iso3: "AUS" },
  { name: "Rio Tinto", type: "company", category: "mining", iso3: "GBR" },
  { name: "Maersk", type: "company", category: "logistics", iso3: "DNK" },
  { name: "Vale S.A.", type: "company", category: "mining", iso3: "BRA" },
  { name: "Reliance Industries", type: "company", category: "conglomerate", iso3: "IND" },
  ...[
    "Crude Oil", "Natural Gas", "Coal", "Gold", "Silver", "Copper", "Iron Ore", "Aluminum", "Zinc", "Nickel", "Tin", "Lead",
    "Platinum", "Palladium", "Wheat", "Corn", "Rice", "Soybeans", "Coffee", "Cocoa", "Sugar", "Cotton", "Palm Oil", "Rubber",
    "Lumber", "Wool", "Beef", "Pork", "Poultry", "Lithium", "Cobalt", "Rare Earth Elements", "Uranium", "Titanium", "Fertilizer",
    "Phosphate", "Potash", "Ammonia", "Urea", "LNG", "Ethanol", "Biodiesel", "Hydrogen", "Solar Panels", "Semiconductors",
    "Microchips", "Steel", "Cement", "Glass",
  ].map((name): SeedEntity => ({ name, type: "commodity", category: "commodity" })),
  ...[
    "Agriculture", "Mining", "Manufacturing", "Construction", "Utilities", "Wholesale Trade", "Retail Trade", "Transportation",
    "Information Technology", "Financial Services", "Real Estate", "Professional Services", "Education Services", "Healthcare",
    "Arts and Entertainment", "Accommodation and Food Services", "Public Administration", "Defense", "Energy", "Telecommunications",
    "Pharmaceuticals", "Biotechnology", "Aerospace", "Automotive", "Consumer Electronics", "E-commerce", "Fintech", "Insurance",
    "Logistics and Supply Chain", "Maritime Shipping",
  ].map((name): SeedEntity => ({ name, type: "sector", category: "sector" })),
];

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
  let aliasesCreated = 0;
  let externalIdsCreated = 0;
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
    const iso2 = asString(raw.iso2Code);
    const { data: entity, error } = await supabase.from("canonical_entities").upsert({
      canonical_name: name,
      normalized_name: name.toLowerCase(),
      entity_type: "country",
      iso3,
      lat,
      lon,
      display_name: name,
      source_count: 1,
      trust_score: null,
      trust_score_semantics: "unmeasured",
      evidence_status: "provider_supplied_identity_fields_not_independently_verified",
      metadata: {
        provider: "worldbank",
        provider_fields_observed: true,
        trust_score_status: "unmeasured",
        region: raw.region?.value ?? null,
        income_level: raw.incomeLevel?.value ?? null,
        capital: raw.capitalCity ?? null,
        iso2,
        wb_lending_type: raw.lendingType?.value ?? null,
      },
      last_resolved_at: null,
    }, { onConflict: "entity_type,normalized_name" }).select("id").single();
    if (error || !entity?.id) {
      errors.push(`${iso3}: ${error?.message ?? "country upsert returned no id"}`);
      continue;
    }
    seeded++;

    const aliases: Array<{ alias: string; alias_type: "iso_code" | "name" | "abbreviation" }> = [
      { alias: iso3, alias_type: "iso_code" },
      { alias: name.toLowerCase(), alias_type: "name" },
    ];
    if (iso2) aliases.push({ alias: iso2, alias_type: "iso_code" });
    if (name.includes("(")) aliases.push({ alias: name.split("(")[0].trim(), alias_type: "abbreviation" });

    for (const alias of aliases) {
      const { error: aliasError } = await supabase.from("entity_aliases").upsert({
        entity_id: entity.id,
        alias: alias.alias,
        alias_type: alias.alias_type,
        source: "worldbank",
        confidence: null,
        confidence_semantics: "provider_supplied_alias_not_calibrated_probability",
        verification_status: "provider_supplied_not_independently_verified",
      }, { onConflict: "entity_id,alias,alias_type", ignoreDuplicates: true });
      if (aliasError) errors.push(`${iso3} alias ${alias.alias}: ${aliasError.message}`); else aliasesCreated++;
    }

    const externalIds = [{ provider: "worldbank", external_id: iso3, external_type: "worldbank_country_id" }];
    if (iso2) externalIds.push({ provider: "worldbank", external_id: iso2, external_type: "provider_iso2_code" });
    for (const externalId of externalIds) {
      const { error: externalIdError } = await supabase.from("entity_external_ids").upsert({
        entity_id: entity.id,
        ...externalId,
        last_verified_at: null,
        verification_status: "provider_supplied_not_independently_verified",
        verification_method: "worldbank_country_payload",
      }, { onConflict: "provider,external_id", ignoreDuplicates: true });
      if (externalIdError) errors.push(`${iso3} external id ${externalId.external_id}: ${externalIdError.message}`); else externalIdsCreated++;
    }
  }

  return {
    ok: errors.length === 0,
    phase: "A",
    countries_seeded: seeded,
    aliases_created_or_existing: aliasesCreated,
    external_ids_created_or_existing: externalIdsCreated,
    withheld,
    errors: errors.slice(0, 20),
    semantics: "country identity breadth restored without assigning synthetic trust or identity confidence",
  };
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
      confidence_semantics: "unmeasured",
      provenance_source: "worldbank",
      provenance_observed_at: null,
      provenance_observed_at_semantics: "provider_period_only_no_observation_timestamp",
      dedup_key: `m:worldbank:${metricName}:${iso3}:${period}:${entityId}`,
      freshness_score: null,
      freshness_semantics: "unmeasured",
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
    total_indicators: ALL_INDICATORS.length,
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
  const errors: string[] = [];
  for (const region of data ?? []) {
    if (!region.name || !region.country_iso3) continue;
    const normalizedName = `${region.name}, ${region.country_iso3}`.toLowerCase();
    const { error: insertError } = await supabase.from("canonical_entities").upsert({
      canonical_name: `${region.name}, ${region.country_iso3}`,
      normalized_name: normalizedName,
      entity_type: "city",
      iso3: null,
      lat: region.lat,
      lon: region.lon,
      display_name: region.name,
      trust_score: null,
      trust_score_semantics: "unmeasured",
      source_count: 1,
      evidence_status: "admin_region_source_record_present_identity_not_independently_verified",
      metadata: {
        admin_level: region.admin_level,
        country_iso3: region.country_iso3,
        population_est: region.population_est,
        urban_rural: region.urban_rural,
        admin_region_id: region.id,
        trust_score_status: "unmeasured",
      },
      last_resolved_at: null,
    }, { onConflict: "entity_type,normalized_name" });
    if (!insertError) promoted++; else errors.push(`${region.name}: ${insertError.message}`);
  }

  await supabase.from("backfill_state").upsert({
    key: "region_offset", value_int: offset + limit, updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  return { ok: errors.length === 0, phase: "D", offset, limit, promoted, next_offset: offset + limit, has_more: (data?.length ?? 0) === limit, errors: errors.slice(0, 20) };
}

async function seedEntities(supabase: DbClient, params: JsonObject) {
  const entityClass = asString(params.entity_class) ?? "all";
  let createdOrExisting = 0;
  const errors: string[] = [];

  for (const entity of SEEDED_ENTITIES) {
    const matchesClass = entityClass === "all"
      || (entityClass === "organizations" && entity.type === "company")
      || (entityClass === "commodities" && entity.type === "commodity")
      || (entityClass === "sectors" && entity.type === "sector");
    if (!matchesClass) continue;

    const { error } = await supabase.from("canonical_entities").upsert({
      canonical_name: entity.name,
      normalized_name: entity.name.toLowerCase(),
      entity_type: entity.type,
      display_name: entity.name,
      iso3: entity.iso3 ?? null,
      trust_score: null,
      trust_score_semantics: "unmeasured",
      source_count: 1,
      evidence_status: "curated_seed_identity_not_independently_verified",
      metadata: {
        category: entity.category,
        provenance: "curated_seed",
        trust_score_status: "unmeasured",
        country_association_semantics: entity.iso3 ? "curated_headquarters_or_origin_hint_not_entity_confidence" : null,
      },
      last_resolved_at: null,
    }, { onConflict: "entity_type,normalized_name", ignoreDuplicates: true });
    if (!error) createdOrExisting++; else errors.push(`${entity.name}: ${error.message}`);
  }

  return {
    ok: errors.length === 0,
    phase: "D2",
    entities_created_or_existing: createdOrExisting,
    catalog_size: SEEDED_ENTITIES.length,
    errors: errors.slice(0, 20),
    semantics: "legacy catalog breadth restored as curated identity seeds; no calibrated trust score assigned",
  };
}

async function generateLinks(supabase: DbClient, params: JsonObject) {
  const linkType = asString(params.link_type) ?? "all";
  const limit = Math.min(5000, Math.max(1, Math.trunc(asNumber(params.limit) ?? 2000)));
  let linksCreatedOrExisting = 0;
  const errors: string[] = [];

  if (linkType === "all" || linkType === "metric_entity") {
    const { data, error } = await supabase.from("normalized_metrics")
      .select("id, entity_id").not("entity_id", "is", null).limit(limit);
    if (error) throw error;
    const rows = (data ?? []).filter((row) => row.entity_id).map((row) => ({
      metric_id: row.id,
      entity_id: row.entity_id,
      link_role: "primary_entity",
      confidence: null,
      confidence_semantics: "deterministic_existing_foreign_key_association_not_probability",
    }));
    if (rows.length > 0) {
      const { error: upsertError } = await supabase.from("entity_metric_links")
        .upsert(rows, { onConflict: "metric_id,entity_id,link_role", ignoreDuplicates: true });
      if (upsertError) errors.push(`metric_entity: ${upsertError.message}`); else linksCreatedOrExisting += rows.length;
    }
  }

  if (linkType === "all" || linkType === "metric_entity" || linkType === "metric_entity_iso3") {
    const isoMap = await getCanonicalEntityMap(supabase);
    const { data: cursorRow, error: cursorError } = await supabase.from("backfill_state")
      .select("value_text").eq("key", "metric_entity_iso3_cursor").maybeSingle();
    if (cursorError) throw cursorError;
    const cursorTs = asIsoTimestamp(cursorRow?.value_text) ?? new Date().toISOString();

    const { data: nullEntityMetrics, error: metricError } = await supabase.from("normalized_metrics")
      .select("id, iso3, created_at")
      .is("entity_id", null)
      .not("iso3", "is", null)
      .lte("created_at", cursorTs)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (metricError) throw metricError;

    const candidates = (nullEntityMetrics ?? []).flatMap((metric) => {
      const entityId = typeof metric.iso3 === "string" ? isoMap.get(metric.iso3) : undefined;
      if (!entityId) return [];
      return [{
        metric_id: metric.id,
        entity_id: entityId,
        link_role: "country",
        confidence: null,
        confidence_semantics: "deterministic_exact_iso3_lookup_not_probability",
      }];
    });

    if (candidates.length > 0) {
      const { error: isoLinkError } = await supabase.from("entity_metric_links")
        .upsert(candidates, { onConflict: "metric_id,entity_id,link_role", ignoreDuplicates: true });
      if (isoLinkError) errors.push(`metric_entity_iso3: ${isoLinkError.message}`); else linksCreatedOrExisting += candidates.length;
    }

    if ((nullEntityMetrics?.length ?? 0) > 0) {
      const oldest = nullEntityMetrics![nullEntityMetrics!.length - 1].created_at;
      const oldestMs = typeof oldest === "string" ? Date.parse(oldest) : Number.NaN;
      if (Number.isFinite(oldestMs)) {
        await supabase.from("backfill_state").upsert({
          key: "metric_entity_iso3_cursor",
          value_text: new Date(oldestMs - 1).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "key" });
      }
    } else {
      await supabase.from("backfill_state").upsert({
        key: "metric_entity_iso3_cursor",
        value_text: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    }
  }

  return {
    ok: errors.length === 0,
    phase: "4",
    link_type: linkType,
    links_created_or_existing: linksCreatedOrExisting,
    errors: errors.slice(0, 20),
    semantics: "foreign-key and exact-ISO3 associations are deterministic links; confidence remains unquantified",
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
        started_at_semantics: "legacy_source_created_at_preserved_as_event_time_unverified",
        severity: asNumber(row.conflict_intensity) === null ? null : Math.round(asNumber(row.conflict_intensity)! * 10),
        confidence: asNumber(row.confidence),
        confidence_semantics: asNumber(row.confidence) === null ? "not_quantified" : "legacy_numeric_semantics_unverified",
        provenance_source: "conflict_signals",
        dedup_key: `e:aicis_legacy:conflict:${iso3}:${asString(row.region) ?? "unknown"}:${startedAt}`,
        freshness_score: null,
        freshness_semantics: "not_measured",
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
      const confidence = asNumber(row.confidence_score);
      rows.push({
        provider_name: "aicis_signals",
        event_type: asString(row.category) ?? "signal",
        title: asString(row.title) ?? asString(row.headline) ?? "Signal",
        description: asString(row.summary) ?? "",
        entity_id: iso3 ? entityMap.get(iso3) ?? null : null,
        iso3,
        started_at: startedAt,
        started_at_semantics: asIsoTimestamp(row.detected_at) ? "legacy_detected_at_preserved_unverified" : "legacy_created_at_used_only_when_source_detected_at_absent_unverified",
        severity: asNumber(row.impact_score),
        confidence,
        confidence_semantics: confidence === null ? "not_quantified" : "legacy_numeric_semantics_unverified",
        provenance_source: "global_signals",
        dedup_key: `e:signals:${String(row.id ?? startedAt)}`,
        freshness_score: null,
        freshness_semantics: "not_measured",
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
  const [entities, countries, metrics, events, metricLinks, eventLinks, entityLinks] = await Promise.all([
    supabase.from("canonical_entities").select("*", { count: "exact", head: true }),
    supabase.from("canonical_entities").select("*", { count: "exact", head: true }).in("entity_type", ["country", "territory"]),
    supabase.from("normalized_metrics").select("*", { count: "exact", head: true }),
    supabase.from("normalized_events").select("*", { count: "exact", head: true }),
    supabase.from("entity_metric_links").select("*", { count: "exact", head: true }),
    supabase.from("entity_event_links").select("*", { count: "exact", head: true }),
    supabase.from("entity_links").select("*", { count: "exact", head: true }),
  ]);
  return {
    ok: true,
    totals: {
      entities: entities.count ?? 0,
      countries_territories: countries.count ?? 0,
      metrics: metrics.count ?? 0,
      events: events.count ?? 0,
      metric_links: metricLinks.count ?? 0,
      event_links: eventLinks.count ?? 0,
      entity_links: entityLinks.count ?? 0,
    },
    catalog: {
      world_bank_indicators: ALL_INDICATORS.length,
      curated_entities: SEEDED_ENTITIES.length,
    },
    status_semantics: "observed database counts and configured catalog sizes only; no readiness percentage implied",
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
      _metadata: { action, epistemic_contract: "truth_floor_v1", functional_parity: "breadth_restoration_v1" },
    });
    return jsonRes(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "planetary-backfill",
      _success: false,
      _error: message,
      _metadata: { action, epistemic_contract: "truth_floor_v1", functional_parity: "breadth_restoration_v1" },
    });
    return jsonRes({ error: message }, 500);
  }
});
