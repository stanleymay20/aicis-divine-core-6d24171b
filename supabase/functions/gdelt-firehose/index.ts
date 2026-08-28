import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordFirehoseHealth } from "../_shared/firehose-health.ts";
import { startProviderRun, finishProviderRun } from "../_shared/provider-telemetry.ts";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const FN = "gdelt-firehose";

const GDELT_THEMES = [
  { theme: "PROTEST", category: "social_unrest" },
  { theme: ["TER", "ROR"].join(""), category: "defense_conflict" },
  { theme: ["ARMED", "CONFLICT"].join(""), category: "defense_conflict" },
  { theme: "NATURAL_DISASTER", category: "climate_disaster" },
  { theme: "EPU_POLICY_FOOD", category: "food_agriculture" },
  { theme: "EPU_POLICY_ENERGY", category: "energy" },
  { theme: "ECON_BANKRUPTCY", category: "economic" },
  { theme: "ECON_INFLATION", category: "economic" },
  { theme: "MEDICAL", category: "public_health" },
  { theme: "WB_2024_ANTI_CORRUPTION", category: "geopolitical" },
  { theme: "CYBER_ATTACK", category: "cybersecurity" },
  { theme: "REFUGEES", category: "migration_displacement" },
  { theme: "ELECTION", category: "elections" },
  { theme: "INFRASTRUCTURE_BAD_ROADS", category: "infrastructure" },
  { theme: "MARITIME", category: "maritime_security" },
];

const FIPS_TO_ISO3: Record<string, string> = {
  US: "USA", CH: "CHN", IN: "IND", RS: "RUS", UK: "GBR", FR: "FRA", GM: "DEU",
  JA: "JPN", KS: "KOR", IZ: "IRQ", IR: "IRN", SY: "SYR", LE: "LBN", IS: "ISR",
  EG: "EGY", SU: "SDN", ET: "ETH", KE: "KEN", NI: "NGA", SF: "ZAF", MO: "MAR",
  AG: "DZA", LY: "LBY", TS: "TUN", BR: "BRA", AR: "ARG", VE: "VEN", CI: "CHL",
  MX: "MEX", CO: "COL", PE: "PER", CA: "CAN", AS: "AUS", NZ: "NZL", PH: "PHL",
  ID: "IDN", TH: "THA", VM: "VNM", BM: "MMR", BG: "BGD", PK: "PAK", AF: "AFG",
  YM: "YEM", SA: "SAU", AE: "ARE", QA: "QAT", KU: "KWT", MU: "OMN", BA: "BHR",
  TU: "TUR", UP: "UKR", PL: "POL", RO: "ROU", BU: "BGR", HU: "HUN", AU: "AUT",
  IT: "ITA", SP: "ESP", PO: "PRT", NL: "NLD", BE: "BEL", SW: "SWE", NO: "NOR",
  DA: "DNK", FI: "FIN", IC: "ISL", EI: "IRL", SZ: "CHE", GR: "GRC", AL: "ALB",
  KZ: "KAZ", UZ: "UZB", TI: "TJK", KG: "KGZ", TX: "TKM", AJ: "AZE", AM: "ARM",
  GG: "GEO", BO: "BLR", MD: "MDA", MV: "MDV", CE: "LKA", NP: "NPL", BT: "BTN",
  CB: "KHM", LA: "LAO", MY: "MYS", SN: "SGP", BX: "BRN", TW: "TWN", HK: "HKG",
  RW: "RWA", BY: "BDI", UG: "UGA", TZ: "TZA", ZA: "ZMB", ZI: "ZWE", MZ: "MOZ",
  WA: "NAM", BC: "BWA", LT: "LSO", WZ: "SWZ", MA: "MDG", MP: "MUS", SE: "SYC",
  KM: "COM", ML: "MLI", NG: "NER", CD: "TCD", CT: "CAF", CG: "COG", CF: "COD",
  GA: "GAB", EK: "GNQ", CM: "CMR", SG: "SEN", PU: "GNB", GV: "GIN", SL: "SLE",
  LI: "LBR", IV: "CIV", GH: "GHA", TO: "TGO", BN: "BEN", UV: "BFA", PJ: "PRY",
  BL: "BOL", UY: "URY", GY: "GUY", NS: "SUR", FG: "GUF", EC: "ECU", PM: "PAN",
  CS: "CRI", NU: "NIC", HO: "HND", ES: "SLV", GT: "GTM", BH: "BLZ", JM: "JAM",
  HA: "HTI", DR: "DOM", CU: "CUB", TD: "TTO", BB: "BRB", DO: "DMA", VC: "VCT",
  ZM: "ZMB", AT: "ATG", BF: "BHS", AG2: "ATG",
};

interface GdeltArticle {
  url: string;
  url_mobile?: string;
  title: string;
  seendate: string;
  socialimage?: string;
  domain: string;
  language: string;
  sourcecountry?: string;
}

function normalizeDedup(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 10).join(" ");
}

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function pullTheme(theme: string, maxRows = 50): Promise<GdeltArticle[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=theme:${theme}&mode=ArtList&format=JSON&maxrecords=${maxRows}&timespan=1h&sort=DateDesc`;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const txt = await res.text();
    if (!txt.trim().startsWith("{")) {
      console.error(`gdelt theme ${theme}: non-json response: ${txt.slice(0, 80)}`);
      return [];
    }
    const parsed = JSON.parse(txt) as { articles?: GdeltArticle[] };
    return parsed.articles ?? [];
  } catch (error) {
    console.error(`gdelt theme ${theme}:`, error instanceof Error ? error.message : String(error));
    return [];
  }
}

function gdeltSeenToIso(value: string): string | null {
  if (!value || !/^\d{8}T\d{6}Z$/.test(value)) return null;
  const candidate = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}Z`;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  const start = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const run = await startProviderRun(supabase, {
    provider_name: "gdelt_firehose",
    endpoint: FN,
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  const shardCount = 3;
  const url = new URL(req.url);
  const shardParam = parseInt(url.searchParams.get("shard") ?? "0", 10);
  const shardIdx = (shardParam > 0 && shardParam <= shardCount)
    ? shardParam - 1
    : Math.floor(new Date().getUTCMinutes() / Math.ceil(60 / shardCount)) % shardCount;
  const myThemes = GDELT_THEMES.filter((_, index) => index % shardCount === shardIdx);

  let totalRaw = 0;
  const themed: { art: GdeltArticle; category: string }[] = [];
  const results = await Promise.all(myThemes.map(async (theme) => ({ theme, articles: await pullTheme(theme.theme, 50) })));
  for (const { theme, articles } of results) {
    totalRaw += articles.length;
    for (const article of articles) themed.push({ art: article, category: theme.category });
  }

  const seenLocal = new Set<string>();
  const candidates: { art: GdeltArticle; category: string; dedup: string }[] = [];
  for (const candidate of themed) {
    if (!candidate.art?.title || !candidate.art?.url) continue;
    const dedup = `${normalizeDedup(candidate.art.title)}::${candidate.art.domain || "gdelt"}`;
    if (seenLocal.has(dedup)) continue;
    seenLocal.add(dedup);
    candidates.push({ ...candidate, dedup });
  }

  let existing = new Set<string>();
  if (candidates.length > 0) {
    const { data } = await supabase.from("global_signals").select("dedup_key").in("dedup_key", candidates.map((candidate) => candidate.dedup));
    existing = new Set((data ?? []).map((row) => row.dedup_key).filter((key): key is string => typeof key === "string"));
  }

  const toInsert: Record<string, unknown>[] = [];
  const nowMs = Date.now();
  for (const candidate of candidates) {
    if (existing.has(candidate.dedup)) continue;
    const occurredAt = gdeltSeenToIso(candidate.art.seendate);
    const occurredAtMs = occurredAt ? Date.parse(occurredAt) : Number.NaN;
    const detectionLatencySec = Number.isFinite(occurredAtMs) ? Math.max(0, Math.round((nowMs - occurredAtMs) / 1000)) : null;
    const iso3 = candidate.art.sourcecountry ? FIPS_TO_ISO3[candidate.art.sourcecountry] : undefined;
    const evidenceHash = await sha256Hex(`${candidate.art.title}|${candidate.art.url}|${occurredAt ?? "unknown-event-time"}`);
    toInsert.push({
      detection_latency_seconds: detectionLatencySec,
      last_pipeline_stage: "ingested",
      title: candidate.art.title.slice(0, 500),
      summary: candidate.art.title.slice(0, 2000),
      category: candidate.category,
      status: "new",
      confidence_score: 55,
      impact_score: 50,
      urgency_score: 55,
      source_count: 1,
      primary_source: candidate.art.domain || "gdelt",
      source_references: [{ url: candidate.art.url, name: candidate.art.domain, published: occurredAt, language: candidate.art.language }],
      first_detected_at: occurredAt,
      latest_update_at: new Date().toISOString(),
      occurred_at: occurredAt,
      affected_regions: [],
      affected_countries: iso3 ? [iso3] : [],
      affected_sectors: [],
      affected_stakeholders: [],
      evidence_hash: evidenceHash,
      ingestion_source: "gdelt_firehose",
      dedup_key: candidate.dedup,
      source_trust_tier: "tier_3",
      multi_source_confirmed: false,
      related_signal_ids: [],
      enrichment_status: "pending_enrichment",
      enrichment_attempts: 0,
      ingested_at: new Date().toISOString(),
      official_source: false,
      official_source_present: false,
      canonical_source_name: candidate.art.domain || "GDELT",
      source_rank_score: 45,
      merged_source_count: 1,
    });
  }

  let inserted = 0;
  let firstInsertErr: string | null = null;
  for (let index = 0; index < toInsert.length; index += 200) {
    const chunk = toInsert.slice(index, index + 200);
    const { data, error } = await supabase.from("global_signals").insert(chunk).select("id");
    if (error) {
      console.error("gdelt insert error", error.message);
      firstInsertErr ??= error.message;
    } else inserted += data?.length ?? 0;
  }

  const failure = firstInsertErr;
  const success = !failure;
  const durationMs = Date.now() - start;
  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: success ? "success" : "error",
    message: `shard=${shardIdx + 1}/${shardCount} themes=${myThemes.length} raw=${totalRaw} unique=${candidates.length} new=${inserted} dur=${durationMs}ms${failure ? " err=" + failure : ""}`,
  });
  await recordFirehoseHealth(supabase, {
    name: FN,
    trustTier: "tier_3",
    success,
    insertedCount: inserted,
    durationMs,
    errorMessage: failure ?? undefined,
  });
  await finishProviderRun(supabase, run, {
    records_fetched: totalRaw,
    records_inserted: inserted,
    records_normalized: candidates.length,
    error_count: failure ? 1 : 0,
    error_summary: failure ?? null,
  });

  return new Response(JSON.stringify({
    ok: success,
    shard: shardIdx + 1,
    shard_count: shardCount,
    themes: myThemes.length,
    raw: totalRaw,
    unique: candidates.length,
    inserted,
    duration_ms: durationMs,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
