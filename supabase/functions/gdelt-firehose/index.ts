/**
 * gdelt-firehose — pulls the latest GDELT 2.0 GKG/Doc API and ingests
 * into global_signals as a high-volume planetary event stream.
 *
 * Free, no key. Source: https://api.gdeltproject.org/api/v2/doc/doc
 * Pulls last 15 minutes of global articles, multi-language, normalized.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordFirehoseHealth } from "../_shared/firehose-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const FN = "gdelt-firehose";

const GDELT_THEMES = [
  // Each theme call ~ tens of articles. We sweep critical decision domains.
  { theme: "PROTEST", category: "social_unrest" },
  { theme: "TERROR", category: "defense_conflict" },
  { theme: "ARMEDCONFLICT", category: "defense_conflict" },
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

// ISO3 by GDELT FIPS country mapping (subset; GDELT uses FIPS-10 codes)
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
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=theme:${theme}&mode=ArtList&format=JSON&maxrecords=${maxRows}&timespan=30min&sort=DateDesc`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const j = await res.json().catch(() => ({}));
    return (j?.articles ?? []) as GdeltArticle[];
  } catch (e) {
    console.error(`gdelt theme ${theme}:`, (e as Error).message);
    return [];
  }
}

function gdeltSeenToIso(s: string): string {
  // "20260505T103000Z" -> "2026-05-05T10:30:00Z"
  if (!s || s.length < 15) return new Date().toISOString();
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Phase 4.1: shard themes per invocation to avoid edge timeouts.
  // Default 3 shards, rotated by ?shard=1|2|3 or by minute window.
  const SHARD_COUNT = 3;
  const url = new URL(req.url);
  const shardParam = parseInt(url.searchParams.get("shard") ?? "0", 10);
  const shardIdx = (shardParam > 0 && shardParam <= SHARD_COUNT)
    ? shardParam - 1
    : Math.floor(new Date().getUTCMinutes() / Math.ceil(60 / SHARD_COUNT)) % SHARD_COUNT;
  const myThemes = GDELT_THEMES.filter((_, i) => i % SHARD_COUNT === shardIdx);

  let totalRaw = 0;
  const themed: { art: GdeltArticle; category: string }[] = [];
  let firstErr: string | null = null;

  for (const t of myThemes) {
    const arts = await pullTheme(t.theme, 50);
    totalRaw += arts.length;
    for (const a of arts) themed.push({ art: a, category: t.category });
    await new Promise(r => setTimeout(r, 100));
  }

  // Local dedup by normalized title + domain
  const seenLocal = new Set<string>();
  const candidates: { art: GdeltArticle; category: string; dedup: string }[] = [];
  for (const c of themed) {
    if (!c.art?.title || !c.art?.url) continue;
    const dedup = `${normalizeDedup(c.art.title)}::${c.art.domain || "gdelt"}`;
    if (seenLocal.has(dedup)) continue;
    seenLocal.add(dedup);
    candidates.push({ ...c, dedup });
  }

  // DB dedup
  let existing = new Set<string>();
  if (candidates.length > 0) {
    const { data } = await supabase
      .from("global_signals")
      .select("dedup_key")
      .in("dedup_key", candidates.map(c => c.dedup));
    existing = new Set((data ?? []).map((r: any) => r.dedup_key));
  }

  const toInsert: any[] = [];
  const nowMs = Date.now();
  for (const c of candidates) {
    if (existing.has(c.dedup)) continue;
    const occurredAt = gdeltSeenToIso(c.art.seendate);
    const detectionLatencySec = Math.max(0, Math.round((nowMs - new Date(occurredAt).getTime()) / 1000));
    const iso3 = c.art.sourcecountry ? FIPS_TO_ISO3[c.art.sourcecountry] : undefined;
    const evidenceHash = await sha256Hex(`${c.art.title}|${c.art.url}|${occurredAt}`);
    toInsert.push({
      detection_latency_seconds: detectionLatencySec,
      last_pipeline_stage: "ingested",
      title: c.art.title.slice(0, 500),
      summary: c.art.title.slice(0, 2000),
      category: c.category,
      status: "new",
      confidence_score: 55,
      impact_score: 50,
      urgency_score: 55,
      source_count: 1,
      primary_source: c.art.domain || "gdelt",
      source_references: [{ url: c.art.url, name: c.art.domain, published: occurredAt, language: c.art.language }],
      first_detected_at: occurredAt,
      latest_update_at: new Date().toISOString(),
      occurred_at: occurredAt,
      affected_regions: [],
      affected_countries: iso3 ? [iso3] : [],
      affected_sectors: [],
      affected_stakeholders: [],
      evidence_hash: evidenceHash,
      ingestion_source: "gdelt_firehose",
      dedup_key: c.dedup,
      source_trust_tier: "tier_3",
      multi_source_confirmed: false,
      related_signal_ids: [],
      enrichment_status: "pending_enrichment",
      enrichment_attempts: 0,
      ingested_at: new Date().toISOString(),
      official_source: false,
      official_source_present: false,
      canonical_source_name: c.art.domain || "GDELT",
      source_rank_score: 45,
      merged_source_count: 1,
    });
  }

  let inserted = 0;
  let firstInsertErr: string | null = null;
  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      const { data, error } = await supabase.from("global_signals").insert(chunk).select("id");
      if (error) {
        console.error("gdelt insert error", error.message);
        if (!firstInsertErr) firstInsertErr = error.message;
      } else {
        inserted += data?.length ?? 0;
      }
    }
  }

  const failure = firstErr || firstInsertErr;
  const success = !failure;

  const dur = Date.now() - start;
  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: success ? "success" : "error",
    message: `shard=${shardIdx + 1}/${SHARD_COUNT} themes=${myThemes.length} raw=${totalRaw} unique=${candidates.length} new=${inserted} dur=${dur}ms${failure ? " err=" + failure : ""}`,
  });
  await recordFirehoseHealth(supabase, {
    name: FN, trustTier: "tier_3",
    success, insertedCount: inserted, durationMs: dur,
    errorMessage: failure ?? undefined,
  });

  return new Response(JSON.stringify({
    ok: success,
    shard: shardIdx + 1,
    shard_count: SHARD_COUNT,
    themes: myThemes.length,
    raw: totalRaw,
    unique: candidates.length,
    inserted,
    duration_ms: dur,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
