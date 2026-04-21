/**
 * planetary-backfill — Full-scale AICIS data engine
 * 
 * Targets: 211+ countries, 10M+ metrics, 1M+ entities, millions of links
 * 
 * Actions:
 *   seed_countries    — Seed all 211+ countries from WB API into canonical_entities
 *   bulk_ingest       — Scheduler-safe: one indicator per run, persistent progress
 *   promote_regions   — Promote admin_regions into canonical_entities
 *   seed_entities     — Seed organizations, commodities, sectors, institutions
 *   generate_links    — Mass-generate entity_links, entity_metric_links
 *   unify_legacy      — Migrate legacy tables into normalized_metrics/events
 *   status            — Report progress against planetary targets
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WB_BASE = "https://api.worldbank.org/v2";

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let action: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    const { action: act, ...params } = body;
    action = act;

    let response: Response;
    switch (action) {
      case "seed_countries": response = await seedCountries(supabase, params); break;
      case "bulk_ingest": response = await bulkIngest(supabase, params); break;
      case "promote_regions": response = await promoteRegions(supabase, params); break;
      case "seed_entities": response = await seedEntities(supabase, params); break;
      case "generate_links": response = await generateLinks(supabase, params); break;
      case "unify_legacy": response = await unifyLegacy(supabase, params); break;
      case "status": response = await getStatus(supabase); break;
      default:
        return jsonRes({ error: `Unknown action: ${action}` }, 400);
    }

    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "planetary-backfill",
      _success: true,
      _metadata: { action },
    });
    return response;
  } catch (e) {
    console.error("planetary-backfill error:", e);
    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "planetary-backfill",
      _success: false,
      _error: (e as Error).message,
      _metadata: { action },
    });
    return jsonRes({ error: (e as Error).message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// HELPERS: Canonical entity map (countries + territories)
// ═══════════════════════════════════════════════════════════════
async function getCanonicalEntityMap(supabase: any): Promise<Map<string, string>> {
  const { data: entities } = await supabase
    .from("canonical_entities")
    .select("id, iso3")
    .in("entity_type", ["country", "territory"])
    .not("iso3", "is", null);
  return new Map((entities || []).map((e: any) => [e.iso3, e.id]));
}

// ═══════════════════════════════════════════════════════════════
// PHASE A: SEED ALL 211+ COUNTRIES
// ═══════════════════════════════════════════════════════════════
async function seedCountries(supabase: any, _params: any) {
  console.log("Seeding all 211+ countries from World Bank API...");

  const resp = await fetch(`${WB_BASE}/country?format=json&per_page=400`);
  const data = await resp.json();
  if (!Array.isArray(data) || !data[1]) return jsonRes({ error: "WB API failed" }, 502);

  const wbCountries = data[1].filter((c: any) =>
    c.region?.id !== "NA" && c.capitalCity && c.id?.length === 3
  );

  console.log(`Found ${wbCountries.length} countries/territories from World Bank`);

  let seeded = 0;
  let aliasesCreated = 0;
  let externalIdsCreated = 0;
  const errors: string[] = [];

  for (const c of wbCountries) {
    try {
      const iso3 = c.id;
      const name = c.name;
      const lat = parseFloat(c.latitude) || null;
      const lon = parseFloat(c.longitude) || null;
      const region = c.region?.value || null;
      const incomeLevel = c.incomeLevel?.value || null;
      const iso2 = c.iso2Code || null;

      const normalizedName = name.toLowerCase().trim();
      const { data: entity, error: upsertErr } = await supabase
        .from("canonical_entities")
        .upsert({
          canonical_name: name,
          normalized_name: normalizedName,
          entity_type: "country",
          iso3,
          lat, lon,
          display_name: name,
          trust_score: 0.95,
          source_count: 1,
          metadata: { region, income_level: incomeLevel, capital: c.capitalCity, iso2, wb_lending_type: c.lendingType?.value },
          last_resolved_at: new Date().toISOString(),
        }, { onConflict: "entity_type,normalized_name" })
        .select("id")
        .single();

      if (upsertErr) { errors.push(`${iso3}: ${upsertErr.message}`); continue; }
      seeded++;
      const entityId = entity.id;

      const aliases: Array<{ alias: string; alias_type: string }> = [];
      if (iso2) aliases.push({ alias: iso2, alias_type: "iso_code" });
      if (iso3) aliases.push({ alias: iso3, alias_type: "iso_code" });
      aliases.push({ alias: name.toLowerCase(), alias_type: "name" });
      if (name.includes("(")) aliases.push({ alias: name.split("(")[0].trim(), alias_type: "abbreviation" });

      for (const a of aliases) {
        const { error: aliasErr } = await supabase
          .from("entity_aliases")
          .upsert({ entity_id: entityId, alias: a.alias, alias_type: a.alias_type, confidence: 1.0, source: "worldbank" },
            { onConflict: "entity_id,alias,alias_type", ignoreDuplicates: true });
        if (!aliasErr) aliasesCreated++;
      }

      const extIds = [{ provider: "worldbank", external_id: iso3, external_type: "iso3" }];
      if (iso2) extIds.push({ provider: "iso", external_id: iso2, external_type: "iso2" });
      for (const ext of extIds) {
        const { error: extErr } = await supabase
          .from("entity_external_ids")
          .upsert({ entity_id: entityId, ...ext, last_verified_at: new Date().toISOString() },
            { onConflict: "entity_id,provider,external_id", ignoreDuplicates: true });
        if (!extErr) externalIdsCreated++;
      }
    } catch (e) {
      errors.push(`${c.id}: ${(e as Error).message}`);
    }
  }

  return jsonRes({ ok: true, phase: "A", countries_seeded: seeded, aliases_created: aliasesCreated, external_ids_created: externalIdsCreated, errors: errors.slice(0, 10), error_count: errors.length });
}

// ═══════════════════════════════════════════════════════════════
// PHASE B: SCHEDULER-SAFE BULK WB INDICATOR INGESTION
// ═══════════════════════════════════════════════════════════════

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

/**
 * Scheduler-safe bulk ingestion:
 * - Exactly ONE indicator per run
 * - Reads current progress from backfill_state
 * - Updates progress after completion
 * - Filters to canonical ISO3 codes only
 * - Supports date_range param for historical depth
 */
async function bulkIngest(supabase: any, params: any) {
  // Determine which indicator to process
  let indicatorIndex: number;
  
  if (params.indicator_index !== undefined) {
    // Direct index override (manual runs)
    indicatorIndex = params.indicator_index;
  } else {
    // Read from persistent state
    const { data: state } = await supabase
      .from("backfill_state")
      .select("value_int")
      .eq("key", "wb_indicator_index")
      .maybeSingle();
    indicatorIndex = state?.value_int ?? 0;
  }

  if (indicatorIndex >= ALL_INDICATORS.length) {
    return jsonRes({
      ok: true, phase: "B", complete: true,
      message: "All indicators processed",
      total_indicators: ALL_INDICATORS.length,
    });
  }

  const indicator = ALL_INDICATORS[indicatorIndex];
  const date_range = params.date_range || "1960:2024";
  const domain = inferDomain(indicator);

  console.log(`[${indicatorIndex}/${ALL_INDICATORS.length}] Ingesting indicator: ${indicator} (${domain}), range: ${date_range}`);

  // Get canonical entity map (countries + territories)
  const entityMap = await getCanonicalEntityMap(supabase);
  const canonicalIso3Set = new Set(entityMap.keys());

  let totalFetched = 0;
  let totalInserted = 0;
  const errors: string[] = [];

  try {
    // Fetch ALL countries at once for this indicator
    // WB API may paginate — fetch up to 3 pages
    let allRecords: any[] = [];
    let page = 1;
    const perPage = 15000;
    
    while (page <= 3) {
      const url = `${WB_BASE}/country/all/indicator/${indicator}?format=json&date=${date_range}&per_page=${perPage}&page=${page}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        errors.push(`HTTP ${resp.status} on page ${page}`);
        break;
      }
      const data = await resp.json();
      if (!Array.isArray(data) || !data[1] || data[1].length === 0) break;
      
      allRecords = allRecords.concat(data[1]);
      
      // Check if more pages
      const totalPages = data[0]?.pages || 1;
      if (page >= totalPages) break;
      page++;
    }

    // Filter: non-null values + canonical ISO3 codes only
    const records = allRecords.filter((r: any) =>
      r.value !== null && r.value !== undefined && canonicalIso3Set.has(r.countryiso3code)
    );
    totalFetched = records.length;

    if (records.length > 0) {
      const metricName = indicator.toLowerCase().replace(/\./g, '_');
      const rows = records.map((r: any) => {
        const iso3 = r.countryiso3code;
        const entityId = entityMap.get(iso3) || null;
        return {
          provider_name: "worldbank",
          domain,
          metric_name: metricName,
          entity_id: entityId,
          iso3,
          period: String(r.date),
          value: parseFloat(r.value),
          unit: r.unit || "",
          confidence: 0.95,
          provenance_source: "worldbank",
          provenance_observed_at: new Date().toISOString(),
          dedup_key: `m:worldbank:${metricName}:${iso3}:${r.date}:${entityId || ""}`,
          freshness_score: 1.0,
          last_verified_at: new Date().toISOString(),
        };
      });

      // Batch upsert in chunks of 1000
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);
        const { error: upsertErr, count } = await supabase
          .from("normalized_metrics")
          .upsert(chunk, { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });

        if (upsertErr) {
          errors.push(`batch ${i}: ${upsertErr.message}`);
        } else {
          totalInserted += count || chunk.length;
        }
      }
    }
  } catch (e) {
    errors.push(`${indicator}: ${(e as Error).message}`);
  }

  // Update persistent progress
  await supabase
    .from("backfill_state")
    .upsert({ key: "wb_indicator_index", value_int: indicatorIndex + 1, updated_at: new Date().toISOString() },
      { onConflict: "key" });

  // Log per-indicator status
  console.log(`[${indicatorIndex}] ${indicator}: fetched=${totalFetched}, inserted=${totalInserted}, errors=${errors.length}`);

  return jsonRes({
    ok: true,
    phase: "B",
    indicator_index: indicatorIndex,
    indicator,
    domain,
    date_range,
    total_indicators: ALL_INDICATORS.length,
    next_indicator_index: indicatorIndex + 1,
    remaining: ALL_INDICATORS.length - indicatorIndex - 1,
    records_fetched: totalFetched,
    records_inserted: totalInserted,
    errors: errors.slice(0, 10),
    error_count: errors.length,
  });
}

// ═══════════════════════════════════════════════════════════════
// PHASE D: PROMOTE ADMIN REGIONS TO CANONICAL ENTITIES
// ═══════════════════════════════════════════════════════════════
async function promoteRegions(supabase: any, params: any) {
  const offset = params.offset || 0;
  const limit = params.limit || 2000;

  console.log(`Promoting admin_regions to canonical_entities, offset=${offset}, limit=${limit}`);

  const { data: regions, error } = await supabase
    .from("admin_regions")
    .select("id, name, admin_level, lat, lon, country_iso3, population_est, urban_rural")
    .not("lat", "is", null)
    .not("lon", "is", null)
    .order("id")
    .range(offset, offset + limit - 1);

  if (error) return jsonRes({ error: error.message }, 500);
  if (!regions || regions.length === 0) {
    return jsonRes({ ok: true, phase: "D", complete: true, promoted: 0 });
  }

  let promoted = 0;
  const errors: string[] = [];

  for (const r of regions) {
    try {
      const { error: insertErr } = await supabase
        .from("canonical_entities")
        .insert({
          canonical_name: `${r.name}, ${r.country_iso3}`,
          entity_type: "city",
          iso3: null,
          lat: r.lat,
          lon: r.lon,
          display_name: r.name,
          trust_score: 0.8,
          source_count: 1,
          metadata: {
            admin_level: r.admin_level,
            country_iso3: r.country_iso3,
            population_est: r.population_est,
            urban_rural: r.urban_rural,
            admin_region_id: r.id,
          },
          last_resolved_at: new Date().toISOString(),
        });
      if (!insertErr) promoted++;
      else if (!insertErr.message?.includes("duplicate")) errors.push(`${r.name}: ${insertErr.message}`);
    } catch (e) {
      errors.push(`${r.name}: ${(e as Error).message}`);
    }
  }

  // Update persistent progress
  await supabase
    .from("backfill_state")
    .upsert({ key: "region_offset", value_int: offset + limit, updated_at: new Date().toISOString() },
      { onConflict: "key" });

  return jsonRes({
    ok: true, phase: "D", offset, limit, promoted,
    next_offset: offset + limit, has_more: regions.length === limit,
    errors: errors.slice(0, 10), error_count: errors.length,
  });
}

// ═══════════════════════════════════════════════════════════════
// PHASE D2: SEED NON-GEO ENTITIES
// ═══════════════════════════════════════════════════════════════
async function seedEntities(supabase: any, params: any) {
  const entityClass = params.entity_class || "all";
  let created = 0;
  const errors: string[] = [];

  const ORGANIZATIONS = [
    { name: "United Nations", type: "company" as const, metadata: { category: "international_org" } },
    { name: "World Bank", type: "company" as const, metadata: { category: "international_org" } },
    { name: "International Monetary Fund", type: "company" as const, metadata: { category: "international_org" } },
    { name: "World Trade Organization", type: "company" as const, metadata: { category: "international_org" } },
    { name: "World Health Organization", type: "company" as const, metadata: { category: "international_org" } },
    { name: "International Labour Organization", type: "company" as const, metadata: { category: "international_org" } },
    { name: "Food and Agriculture Organization", type: "company" as const, metadata: { category: "international_org" } },
    { name: "UNESCO", type: "company" as const, metadata: { category: "international_org" } },
    { name: "UNICEF", type: "company" as const, metadata: { category: "international_org" } },
    { name: "UNHCR", type: "company" as const, metadata: { category: "international_org" } },
    { name: "International Atomic Energy Agency", type: "company" as const, metadata: { category: "international_org" } },
    { name: "Organization of the Petroleum Exporting Countries", type: "company" as const, metadata: { category: "international_org" } },
    { name: "African Union", type: "company" as const, metadata: { category: "regional_org" } },
    { name: "European Union", type: "company" as const, metadata: { category: "regional_org" } },
    { name: "Association of Southeast Asian Nations", type: "company" as const, metadata: { category: "regional_org" } },
    { name: "North Atlantic Treaty Organization", type: "company" as const, metadata: { category: "regional_org" } },
    { name: "European Central Bank", type: "company" as const, metadata: { category: "central_bank" } },
    { name: "Federal Reserve System", type: "company" as const, metadata: { category: "central_bank" } },
    { name: "Bank of England", type: "company" as const, metadata: { category: "central_bank" } },
    { name: "Bank of Japan", type: "company" as const, metadata: { category: "central_bank" } },
    { name: "People's Bank of China", type: "company" as const, metadata: { category: "central_bank" } },
    { name: "Reserve Bank of India", type: "company" as const, metadata: { category: "central_bank" } },
    { name: "International Red Cross", type: "company" as const, metadata: { category: "ngo" } },
    { name: "Médecins Sans Frontières", type: "company" as const, metadata: { category: "ngo" } },
    { name: "Amnesty International", type: "company" as const, metadata: { category: "ngo" } },
    { name: "Transparency International", type: "company" as const, metadata: { category: "ngo" } },
    { name: "Oxfam International", type: "company" as const, metadata: { category: "ngo" } },
    { name: "Greenpeace International", type: "company" as const, metadata: { category: "ngo" } },
    { name: "Apple Inc.", type: "company" as const, metadata: { category: "tech", iso3: "USA" } },
    { name: "Microsoft Corporation", type: "company" as const, metadata: { category: "tech", iso3: "USA" } },
    { name: "Amazon.com Inc.", type: "company" as const, metadata: { category: "tech", iso3: "USA" } },
    { name: "Alphabet Inc.", type: "company" as const, metadata: { category: "tech", iso3: "USA" } },
    { name: "Saudi Aramco", type: "company" as const, metadata: { category: "energy", iso3: "SAU" } },
    { name: "Walmart Inc.", type: "company" as const, metadata: { category: "retail", iso3: "USA" } },
    { name: "ExxonMobil", type: "company" as const, metadata: { category: "energy", iso3: "USA" } },
    { name: "Berkshire Hathaway", type: "company" as const, metadata: { category: "finance", iso3: "USA" } },
    { name: "NVIDIA Corporation", type: "company" as const, metadata: { category: "tech", iso3: "USA" } },
    { name: "Johnson & Johnson", type: "company" as const, metadata: { category: "pharma", iso3: "USA" } },
    { name: "JPMorgan Chase", type: "company" as const, metadata: { category: "finance", iso3: "USA" } },
    { name: "Samsung Electronics", type: "company" as const, metadata: { category: "tech", iso3: "KOR" } },
    { name: "Toyota Motor Corporation", type: "company" as const, metadata: { category: "automotive", iso3: "JPN" } },
    { name: "Tencent Holdings", type: "company" as const, metadata: { category: "tech", iso3: "CHN" } },
    { name: "Shell plc", type: "company" as const, metadata: { category: "energy", iso3: "GBR" } },
    { name: "Nestlé", type: "company" as const, metadata: { category: "food", iso3: "CHE" } },
    { name: "Roche Holding", type: "company" as const, metadata: { category: "pharma", iso3: "CHE" } },
    { name: "LVMH", type: "company" as const, metadata: { category: "luxury", iso3: "FRA" } },
    { name: "HSBC Holdings", type: "company" as const, metadata: { category: "finance", iso3: "GBR" } },
    { name: "Siemens AG", type: "company" as const, metadata: { category: "industrial", iso3: "DEU" } },
    { name: "BHP Group", type: "company" as const, metadata: { category: "mining", iso3: "AUS" } },
    { name: "Rio Tinto", type: "company" as const, metadata: { category: "mining", iso3: "GBR" } },
    { name: "Maersk", type: "company" as const, metadata: { category: "logistics", iso3: "DNK" } },
    { name: "Vale S.A.", type: "company" as const, metadata: { category: "mining", iso3: "BRA" } },
    { name: "Reliance Industries", type: "company" as const, metadata: { category: "conglomerate", iso3: "IND" } },
  ];

  const COMMODITIES = [
    "Crude Oil", "Natural Gas", "Coal", "Gold", "Silver", "Copper", "Iron Ore",
    "Aluminum", "Zinc", "Nickel", "Tin", "Lead", "Platinum", "Palladium",
    "Wheat", "Corn", "Rice", "Soybeans", "Coffee", "Cocoa", "Sugar", "Cotton",
    "Palm Oil", "Rubber", "Lumber", "Wool", "Beef", "Pork", "Poultry",
    "Lithium", "Cobalt", "Rare Earth Elements", "Uranium", "Titanium",
    "Fertilizer", "Phosphate", "Potash", "Ammonia", "Urea",
    "LNG", "Ethanol", "Biodiesel", "Hydrogen", "Solar Panels",
    "Semiconductors", "Microchips", "Steel", "Cement", "Glass",
  ];

  const SECTORS = [
    "Agriculture", "Mining", "Manufacturing", "Construction", "Utilities",
    "Wholesale Trade", "Retail Trade", "Transportation", "Information Technology",
    "Financial Services", "Real Estate", "Professional Services", "Education Services",
    "Healthcare", "Arts and Entertainment", "Accommodation and Food Services",
    "Public Administration", "Defense", "Energy", "Telecommunications",
    "Pharmaceuticals", "Biotechnology", "Aerospace", "Automotive",
    "Consumer Electronics", "E-commerce", "Fintech", "Insurance",
    "Logistics and Supply Chain", "Maritime Shipping",
  ];

  if (entityClass === "all" || entityClass === "organizations") {
    for (const org of ORGANIZATIONS) {
      const { error } = await supabase.from("canonical_entities").insert({
        canonical_name: org.name, entity_type: org.type, display_name: org.name,
        trust_score: 0.9, source_count: 1, iso3: org.metadata.iso3 || null,
        metadata: org.metadata, last_resolved_at: new Date().toISOString(),
      });
      if (!error) created++;
      else if (!error?.message?.includes("duplicate")) errors.push(`${org.name}: ${error.message}`);
    }
  }

  if (entityClass === "all" || entityClass === "commodities") {
    for (const c of COMMODITIES) {
      const { error } = await supabase.from("canonical_entities").insert({
        canonical_name: c, entity_type: "commodity", display_name: c,
        trust_score: 0.95, source_count: 1, metadata: { category: "commodity" },
        last_resolved_at: new Date().toISOString(),
      });
      if (!error) created++;
      else if (!error?.message?.includes("duplicate")) errors.push(`${c}: ${error.message}`);
    }
  }

  if (entityClass === "all" || entityClass === "sectors") {
    for (const s of SECTORS) {
      const { error } = await supabase.from("canonical_entities").insert({
        canonical_name: s, entity_type: "sector", display_name: s,
        trust_score: 0.9, source_count: 1, metadata: { category: "sector" },
        last_resolved_at: new Date().toISOString(),
      });
      if (!error) created++;
      else if (!error?.message?.includes("duplicate")) errors.push(`${s}: ${error.message}`);
    }
  }

  return jsonRes({ ok: true, phase: "D2", entities_created: created, errors: errors.slice(0, 10), error_count: errors.length });
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: GENERATE MASS LINKS
// ═══════════════════════════════════════════════════════════════
async function generateLinks(supabase: any, params: any) {
  const linkType = params.link_type || "all";
  let linksCreated = 0;
  const errors: string[] = [];

  if (linkType === "all" || linkType === "borders") {
    const { data: countries } = await supabase
      .from("canonical_entities")
      .select("id, iso3, metadata")
      .in("entity_type", ["country", "territory"])
      .not("iso3", "is", null);

    if (countries) {
      const regionMap = new Map<string, any[]>();
      for (const c of countries) {
        const region = c.metadata?.region;
        if (region) {
          if (!regionMap.has(region)) regionMap.set(region, []);
          regionMap.get(region)!.push(c);
        }
      }
      for (const [_region, members] of regionMap) {
        for (let i = 0; i < members.length; i++) {
          for (let j = i + 1; j < Math.min(members.length, i + 20); j++) {
            const { error } = await supabase.from("entity_links").upsert({
              source_entity_id: members[i].id, target_entity_id: members[j].id,
              link_type: "borders", strength: 0.6,
              source: "geographic_proximity", provenance_source: "worldbank_regions", provenance_confidence: 0.7,
            }, { onConflict: "source_entity_id,target_entity_id,link_type", ignoreDuplicates: true });
            if (!error) linksCreated++;
          }
        }
      }
    }
  }

  if (linkType === "all" || linkType === "company_country") {
    const { data: companies } = await supabase
      .from("canonical_entities").select("id, metadata, iso3").eq("entity_type", "company").not("metadata", "is", null);
    const { data: countries } = await supabase
      .from("canonical_entities").select("id, iso3").in("entity_type", ["country", "territory"]).not("iso3", "is", null);

    if (companies && countries) {
      const countryMap = new Map(countries.map((c: any) => [c.iso3, c.id]));
      for (const co of companies) {
        const coIso3 = co.iso3 || co.metadata?.iso3;
        const countryId = coIso3 ? countryMap.get(coIso3) : null;
        if (countryId) {
          const { error } = await supabase.from("entity_links").upsert({
            source_entity_id: co.id, target_entity_id: countryId,
            link_type: "headquartered_in", strength: 0.95,
            source: "curated", provenance_source: "entity_seed", provenance_confidence: 0.9,
          }, { onConflict: "source_entity_id,target_entity_id,link_type", ignoreDuplicates: true });
          if (!error) linksCreated++;
        }
      }
    }
  }

  if (linkType === "all" || linkType === "metric_entity") {
    const batchLimit = params.limit || 5000;
    const { data: unlinked } = await supabase
      .from("normalized_metrics").select("id, entity_id")
      .not("entity_id", "is", null).order("id").limit(batchLimit);

    if (unlinked) {
      const metricIds = unlinked.map((m: any) => m.id);
      const { data: existing } = await supabase
        .from("entity_metric_links").select("metric_id").in("metric_id", metricIds.slice(0, 1000));
      const existingSet = new Set((existing || []).map((r: any) => r.metric_id));

      const newLinks = unlinked
        .filter((m: any) => !existingSet.has(m.id))
        .map((m: any) => ({ metric_id: m.id, entity_id: m.entity_id, link_role: "primary_entity", confidence: 0.95 }));

      if (newLinks.length > 0) {
        for (let i = 0; i < newLinks.length; i += 500) {
          const { error } = await supabase
            .from("entity_metric_links")
            .upsert(newLinks.slice(i, i + 500), { onConflict: "metric_id,entity_id,link_role", ignoreDuplicates: true });
          if (!error) linksCreated += Math.min(500, newLinks.length - i);
          else errors.push(error.message);
        }
      }
    }
  }

  return jsonRes({ ok: true, phase: "4", links_created: linksCreated, errors: errors.slice(0, 10), error_count: errors.length });
}

// ═══════════════════════════════════════════════════════════════
// PHASE 6: UNIFY LEGACY DATA
// ═══════════════════════════════════════════════════════════════
async function unifyLegacy(supabase: any, params: any) {
  const source = params.source || "performance_snapshots";
  const offset = params.offset || 0;
  const limit = Math.min(params.limit || 1000, 1000); // Supabase caps at 1000 rows

  let migrated = 0;
  const errors: string[] = [];

  const entityMap = await getCanonicalEntityMap(supabase);

  if (source === "performance_snapshots") {
    const { data: snapshots } = await supabase
      .from("country_performance_snapshots").select("*").order("id").range(offset, offset + limit - 1);

    if (!snapshots || snapshots.length === 0) {
      return jsonRes({ ok: true, phase: "6", source, complete: true, migrated: 0 });
    }

    const rows = snapshots.flatMap((s: any) => {
      const entityId = entityMap.get(s.iso3) || null;
      const fields: [string, string][] = [
        ["performance_index", "performance_index"],
        ["risk_pressure_score", "risk_pressure_score"],
        ["momentum_score", "momentum_score"],
        ["volatility_index", "volatility_index"],
        ["systemic_fragility_score", "systemic_fragility_score"],
        ["confidence_score", "confidence_score"],
        ["forecast_stability_score", "forecast_stability_score"],
        ["forecast_90d", "forecast_90d"],
        ["forecast_1y", "forecast_1y"],
      ];
      return fields
        .filter(([field]) => s[field] !== null && s[field] !== undefined)
        .map(([field, metricName]) => ({
          provider_name: "aicis_legacy",
          domain: s.domain,
          metric_name: `${s.domain}_${metricName}`,
          entity_id: entityId,
          iso3: s.iso3,
          period: s.snapshot_date,
          value: s[field],
          unit: "index",
          confidence: s.confidence_score || 0.8,
          provenance_source: "country_performance_snapshots",
          provenance_observed_at: s.created_at,
          dedup_key: `m:aicis_legacy:${s.domain}_${metricName}:${s.iso3}:${s.snapshot_date}:${entityId || ""}`,
          freshness_score: 0.7,
          last_verified_at: s.created_at,
        }));
    });

    for (let i = 0; i < rows.length; i += 500) {
      const { data: upserted, error } = await supabase
        .from("normalized_metrics")
        .upsert(rows.slice(i, i + 500), { onConflict: "dedup_key", ignoreDuplicates: false })
        .select("id");
      if (error) errors.push(error.message);
      else migrated += (upserted || []).length;
    }

    // Update progress
    await supabase.from("backfill_state")
      .upsert({ key: "legacy_snapshot_offset", value_int: offset + limit, updated_at: new Date().toISOString() }, { onConflict: "key" });

    return jsonRes({ ok: true, phase: "6", source, offset, migrated, next_offset: offset + limit, has_more: snapshots.length === limit, errors: errors.slice(0, 5) });
  }

  if (source === "conflict_signals") {
    const { data: conflicts } = await supabase
      .from("conflict_signals").select("*").order("id").range(offset, offset + limit - 1);

    if (!conflicts || conflicts.length === 0) {
      return jsonRes({ ok: true, phase: "6", source, complete: true, migrated: 0 });
    }

    const rows = conflicts.map((c: any) => {
      const entityId = entityMap.get(c.country_iso3) || null;
      return {
        provider_name: "aicis_legacy",
        event_type: c.conflict_type || "conflict",
        title: `Conflict signal: ${c.region} (${c.country_iso3})`,
        description: c.assessment_md || "",
        entity_id: entityId,
        iso3: c.country_iso3,
        started_at: c.created_at,
        severity: c.conflict_intensity ? Math.round(c.conflict_intensity * 10) : null,
        confidence: c.confidence || 0.5,
        provenance_source: "conflict_signals",
        dedup_key: `e:aicis_legacy:conflict:${c.country_iso3}:${c.region}:${c.created_at}`,
        freshness_score: 0.6,
        last_verified_at: c.updated_at || c.created_at,
        metadata: {
          escalation_probability: c.escalation_probability,
          military_escalation: c.military_escalation,
          protest_momentum: c.protest_momentum,
          diplomatic_tension: c.diplomatic_tension,
          involved_parties: c.involved_parties,
        },
      };
    });

    for (let i = 0; i < rows.length; i += 500) {
      const { data: upserted, error } = await supabase
        .from("normalized_events")
        .upsert(rows.slice(i, i + 500), { onConflict: "dedup_key", ignoreDuplicates: false })
        .select("id");
      if (error) errors.push(error.message);
      else migrated += (upserted || []).length;
    }

    await supabase.from("backfill_state")
      .upsert({ key: "legacy_conflict_offset", value_int: offset + limit, updated_at: new Date().toISOString() }, { onConflict: "key" });

    return jsonRes({ ok: true, phase: "6", source, offset, migrated, next_offset: offset + limit, has_more: conflicts.length === limit, errors: errors.slice(0, 5) });
  }

  if (source === "village_indicators") {
    const { data: indicators } = await supabase
      .from("village_indicators")
      .select("id, region_id, domain, indicator, value, unit, confidence, data_source, observed_at")
      .order("id")
      .range(offset, offset + limit - 1);

    if (!indicators || indicators.length === 0) {
      return jsonRes({ ok: true, phase: "6", source, complete: true, migrated: 0 });
    }

    const regionIds = [...new Set(indicators.map((i: any) => i.region_id).filter(Boolean))];
    const { data: regions } = await supabase
      .from("admin_regions").select("id, country_iso3").in("id", regionIds.slice(0, 500));
    const regionCountryMap = new Map((regions || []).map((r: any) => [r.id, r.country_iso3]));

    const rows = indicators.map((vi: any) => {
      const iso3 = regionCountryMap.get(vi.region_id) || null;
      const entityId = iso3 ? entityMap.get(iso3) : null;
      return {
        provider_name: "aicis_village",
        domain: vi.domain || "subnational",
        metric_name: vi.indicator || "unknown",
        entity_id: entityId,
        iso3,
        period: vi.observed_at ? vi.observed_at.split("T")[0] : new Date().toISOString().split("T")[0],
        value: vi.value,
        unit: vi.unit || "",
        confidence: vi.confidence || 0.6,
        provenance_source: vi.data_source || "village_indicators",
        provenance_observed_at: vi.observed_at,
        dedup_key: `m:village:${vi.indicator}:${vi.region_id}:${vi.observed_at || vi.id}`,
        freshness_score: 0.5,
        last_verified_at: vi.observed_at,
      };
    });

    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await supabase
        .from("normalized_metrics")
        .upsert(rows.slice(i, i + 1000), { onConflict: "dedup_key", ignoreDuplicates: true });
      if (error) errors.push(error.message);
      else migrated += Math.min(1000, rows.length - i);
    }

    await supabase.from("backfill_state")
      .upsert({ key: "legacy_village_offset", value_int: offset + limit, updated_at: new Date().toISOString() }, { onConflict: "key" });

    return jsonRes({ ok: true, phase: "6", source, offset, migrated, next_offset: offset + limit, has_more: indicators.length === limit, errors: errors.slice(0, 5) });
  }

  if (source === "global_signals") {
    const { data: signals } = await supabase
      .from("global_signals").select("*").order("id").range(offset, offset + limit - 1);

    if (!signals || signals.length === 0) {
      return jsonRes({ ok: true, phase: "6", source, complete: true, migrated: 0 });
    }

    const rows = signals.map((s: any) => {
      const iso3 = s.affected_regions?.[0] || null;
      const entityId = iso3 ? entityMap.get(iso3) : null;
      return {
        provider_name: "aicis_signals",
        event_type: s.category || "signal",
        title: s.title || s.headline || "Signal",
        description: s.summary || "",
        entity_id: entityId,
        iso3,
        started_at: s.detected_at || s.created_at,
        severity: s.impact_score || null,
        confidence: s.confidence_score || 0.5,
        provenance_source: "global_signals",
        dedup_key: `e:signals:${s.id}`,
        freshness_score: 0.8,
        last_verified_at: s.created_at,
        metadata: {
          category: s.category,
          urgency: s.urgency_score,
          source_tier: s.source_tier,
          affected_sectors: s.affected_sectors,
        },
      };
    });

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from("normalized_events")
        .upsert(rows.slice(i, i + 500), { onConflict: "dedup_key", ignoreDuplicates: true });
      if (error) errors.push(error.message);
      else migrated += Math.min(500, rows.length - i);
    }

    await supabase.from("backfill_state")
      .upsert({ key: "legacy_signals_offset", value_int: offset + limit, updated_at: new Date().toISOString() }, { onConflict: "key" });

    return jsonRes({ ok: true, phase: "6", source, offset, migrated, next_offset: offset + limit, has_more: signals.length === limit, errors: errors.slice(0, 5) });
  }

  return jsonRes({ error: `Unknown source: ${source}` }, 400);
}

// ═══════════════════════════════════════════════════════════════
// STATUS: REPORT PROGRESS VS PLANETARY TARGETS
// ═══════════════════════════════════════════════════════════════
async function getStatus(supabase: any) {
  const queries = await Promise.all([
    supabase.from("canonical_entities").select("*", { count: "exact", head: true }),
    supabase.from("canonical_entities").select("*", { count: "exact", head: true }).in("entity_type", ["country", "territory"]),
    supabase.from("normalized_metrics").select("*", { count: "exact", head: true }),
    supabase.from("normalized_events").select("*", { count: "exact", head: true }),
    supabase.from("entity_metric_links").select("*", { count: "exact", head: true }),
    supabase.from("entity_event_links").select("*", { count: "exact", head: true }),
    supabase.from("entity_links").select("*", { count: "exact", head: true }),
    supabase.from("entity_aliases").select("*", { count: "exact", head: true }),
    supabase.from("entity_external_ids").select("*", { count: "exact", head: true }),
    supabase.from("data_provenance").select("*", { count: "exact", head: true }),
    supabase.from("backfill_state").select("key, value_int"),
  ]);

  const [entities, countries, metrics, events, metricLinks, eventLinks, entityLinks, aliases, extIds, provenance, backfillState] = queries;

  const totals = {
    entities: entities.count || 0,
    countries_territories: countries.count || 0,
    metrics: metrics.count || 0,
    events: events.count || 0,
    metric_links: metricLinks.count || 0,
    event_links: eventLinks.count || 0,
    entity_links: entityLinks.count || 0,
    total_links: (metricLinks.count || 0) + (eventLinks.count || 0) + (entityLinks.count || 0),
    aliases: aliases.count || 0,
    external_ids: extIds.count || 0,
    provenance: provenance.count || 0,
  };

  const progress_state: Record<string, number> = {};
  for (const row of (backfillState.data || [])) {
    progress_state[row.key] = row.value_int;
  }

  const targets = {
    countries: 211,
    metrics: 10_000_000,
    entities: 1_000_000,
    total_links: 1_000_000,
  };

  return jsonRes({
    ok: true,
    totals,
    targets,
    progress: {
      countries_pct: Math.round((totals.countries_territories / targets.countries) * 100),
      metrics_pct: Math.round((totals.metrics / targets.metrics) * 100 * 100) / 100,
      entities_pct: Math.round((totals.entities / targets.entities) * 100 * 100) / 100,
      links_pct: Math.round((totals.total_links / targets.total_links) * 100 * 100) / 100,
    },
    backfill_state: progress_state,
    gates_passed: {
      countries_211: totals.countries_territories >= 211,
      metrics_10m: totals.metrics >= 10_000_000,
      entities_1m: totals.entities >= 1_000_000,
      links_millions: totals.total_links >= 1_000_000,
      events_active: totals.events > 0,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function inferDomain(indicator: string): string {
  for (const [domain, indicators] of Object.entries(INDICATOR_CATALOG)) {
    if (indicators.includes(indicator)) return domain;
  }
  const i = indicator.toUpperCase();
  if (i.includes("GDP") || i.includes("INF") || i.includes("CPI") || i.includes("DEBT") || i.includes("FDI")) return "finance";
  if (i.includes("POP") || i.includes("LIFE") || i.includes("MORT")) return "demographics";
  if (i.includes("UEM") || i.includes("LABOR") || i.includes("EMP")) return "labor";
  if (i.includes("EXP") || i.includes("IMP") || i.includes("TRADE")) return "trade";
  if (i.includes("CO2") || i.includes("ENERGY") || i.includes("ELEC")) return "environment";
  if (i.includes("EDUC") || i.includes("LITERACY") || i.includes("SCHOOL")) return "education";
  if (i.includes("HEALTH") || i.includes("DISEASE")) return "health";
  return "unknown";
}
