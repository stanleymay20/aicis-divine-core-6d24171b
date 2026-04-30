/**
 * lril-ingest — Local Reality Ingestion Layer: raw signal intake
 *
 * Pulls from multi-source feeds and writes deduplicated raw signals to
 * `aicis_raw_local_signals`. Each source is isolated so one failure
 * cannot block the others. Designed to run every 30 minutes.
 *
 * Sources wired:
 *  1. GDELT DOC API (global news, multilingual) — high volume, no key
 *  2. ReliefWeb (NGO/disaster reports) — JSON, no key
 *  3. Custom payload mode: callers may POST { source_name, items: [...] }
 *
 * Writes are upserted by dedup_key for idempotency.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "lril-ingest";

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

interface RawSignal {
  source_type: string;
  source_name: string;
  source_reliability: number;
  raw_text: string;
  raw_payload: any;
  language: string;
  url: string | null;
  published_at: string | null;
  country_hint: string | null;
  region_hint: string | null;
  dedup_key: string;
}

// Rotating targeted queries — broader coverage of real local incidents.
// Each query is narrow enough to return relevant articles instead of generic noise.
const GDELT_QUERIES = [
  '(xenophobic OR xenophobia OR "operation dudula" OR "foreign nationals attacked")',
  '("communal clash" OR "ethnic clash" OR "sectarian violence" OR "tribal clash" OR "herder farmer")',
  '("mob lynched" OR "vigilante killing" OR "jungle justice" OR "necklacing")',
  '("mass shooting" OR "tavern shooting" OR massacre OR "gunmen open fire")',
  '("gang violence" OR "cartel violence" OR "drive-by shooting" OR "turf war" OR sicarios)',
  '(kidnapped OR abducted OR "mass abduction" OR "schoolgirls kidnapped" OR "for ransom")',
  '(dumsor OR "load shedding" OR loadshedding OR "rolling blackouts" OR "grid collapse")',
  '(protest OR demonstration OR riot OR unrest OR "violent clashes" OR "general strike")',
  '(blackout OR "power outage" OR "national grid" OR "stage 6" OR "stage 8" OR "fuel shortage")',
  '(flood OR earthquake OR landslide OR cyclone OR wildfire OR typhoon OR hurricane)',
  '(outbreak OR cholera OR ebola OR "lassa fever" OR mpox OR dengue OR measles)',
  '(coup OR mutiny OR insurgency OR militants OR "armed group" OR junta)',
  '(famine OR malnutrition OR "ipc phase" OR "acute hunger" OR starvation)',
  '("currency crash" OR devalued OR hyperinflation OR "imf bailout" OR "sovereign default" OR "bank run")',
  '("internet shutdown" OR "social media blocked" OR "vpn restricted" OR "telecom blackout")',
  '("water shortage" OR "no running water" OR "water rationing" OR "reservoir critical")',
  '("airport closed" OR "border closed" OR "port closed" OR "rail shutdown" OR "highway blocked")',
  '("displaced persons" OR refugees OR exodus OR "asylum seekers" OR "migrant boat")',
  '(ransomware OR cyberattack OR "data breach" OR "hospital hacked" OR "grid hacked")',
  '("state of emergency" OR "martial law" OR curfew OR "emergency decree")',
  '("building collapse" OR "tower collapse" OR "trapped in rubble")',
  '(rsf OR "rapid support forces" OR "el fasher" OR darfur)',
  '(houthi OR hezbollah OR "idf strike" OR rafah OR "khan younis" OR jabalia)',
  '(m23 OR adf OR "al-shabaab" OR jnim OR iswap OR "boko haram")',
  '("school attacked" OR "schoolgirls abducted" OR "students killed" OR "university shut")',
  '("hospital attacked" OR "doctors strike" OR "oxygen shortage" OR "medicines shortage")',
  '("bridge collapse" OR "train derailment" OR "ferry capsized" OR "plane crash" OR "building collapse")',
  '("oil spill" OR "tailings dam" OR "chemical leak" OR "gas explosion" OR "toxic cloud")',
  '("nipah" OR "marburg" OR "polio detected" OR "cholera spreading" OR "diphtheria outbreak")',
  '("lockbit" OR "blackcat ransomware" OR "ddos attack" OR "government website hacked" OR "stolen data leaked")',
  '("price hike riot" OR "bread queue" OR "fuel subsidy" OR "forex shortage" OR "dollar shortage")',
  '("wagner" OR "africa corps" OR "tren de aragua" OR "cjng" OR "sinaloa cartel")',
  '("xenophobic attack" OR "anti-immigrant" OR "deportation flight" OR "asylum denied")',
  '("election rigged" OR "ballot stuffing" OR "results disputed" OR "constitutional crisis")',
  // v4: hyperlocal incident classes — village, district, sub-national fatal events
  '("tribal fight" OR "tribal clash" OR "land dispute" OR "inter-clan" OR "payback killing" OR "clan war")',
  '("village massacre" OR "village raid" OR "village burned" OR "homes torched" OR "houses razed")',
  '("mob killing" OR "mob justice" OR "vigilante mob" OR "lynched" OR "burnt alive" OR "necklacing")',
  '("cattle raid" OR "herder attack" OR "pastoralist clash" OR "farmer-herder" OR "boundary dispute")',
  '("bandit attack" OR "bandits killed" OR "bandits abducted" OR "kidnap for ransom" OR "ransom demand")',
  '("illegal mining" OR "artisanal miners killed" OR "galamsey" OR "wildcat miners" OR "mine collapse")',
  '("chieftaincy dispute" OR "chieftaincy clash" OR "communal conflict" OR "ethnic militia")',
  '("Bulolo" OR "Morobe" OR "Hela" OR "Enga" OR "Southern Highlands" OR "Bougainville" OR "Goroka")',
  '("Plateau state" OR "Benue" OR "Zamfara" OR "Kaduna" OR "Borno" OR "Sokoto" OR "Niger state")',
  '("Amhara" OR "Oromia" OR "Tigray" OR "Fano militia" OR "OLA" OR "Benishangul")',
  '("Manipur" OR "Imphal" OR "Kuki" OR "Meitei" OR "Nagaland" OR "Mizoram")',
  '("Rakhine" OR "Chin state" OR "Kachin" OR "Shan state" OR "Sagaing" OR "PDF clash")',
  '("Cabo Delgado" OR "Mocimboa" OR "Pemba" OR "ADF Beni" OR "Ituri" OR "Djugu")',
  '("Chocó" OR "Cauca" OR "Catatumbo" OR "Arauca" OR "Guaviare" OR "Tumaco")',
  '("Sinaloa" OR "Guerrero" OR "Michoacán" OR "Tamaulipas" OR "Chiapas" OR "Zacatecas")',
  // v5: ALL-DOMAIN — industrial / economic / infrastructure / agriculture / science / governance
  '("plant launched" OR "factory inaugurated" OR "assembly line" OR "production hub" OR "industrial zone" OR SEZ OR "manufacturing plant")',
  '("refinery commissioned" OR smelter OR "cement plant" OR "steel mill" OR "automotive plant" OR "EV factory" OR "battery gigafactory")',
  '("plastics components" OR "auto parts plant" OR "petrochemical complex" OR "fertilizer plant" OR "pharma plant")',
  '("FDI deal" OR "foreign investment" OR "trade pact" OR "tariff cut" OR "free trade" OR "bilateral agreement" OR "joint venture")',
  '("central bank" OR "rate hike" OR "rate cut" OR "bond issuance" OR "debt restructuring" OR "sovereign rating" OR eurobond)',
  '("port expansion" OR "rail line opened" OR "metro launched" OR "pipeline commissioned" OR "dam inaugurated" OR "highway opened")',
  '("solar farm" OR "wind farm" OR "data center" OR "fiber network" OR "5G rollout" OR "submarine cable")',
  '("harvest yield" OR "wheat reserve" OR "irrigation scheme" OR "livestock disease" OR "fisheries quota" OR "food security")',
  '("vaccine approved" OR "clinical trial" OR "gene therapy" OR "fusion milestone" OR "satellite launch" OR "lunar mission")',
  '("bill passed" OR referendum OR "cabinet reshuffle" OR "treaty signed" OR "sanctions lifted" OR "constitutional amendment")',
  '("Tissemsilt" OR "Tlemcen" OR "Oran" OR "Constantine" OR "Annaba" OR "Béjaïa" OR "Sétif" OR "Hassi Messaoud" OR "Adrar")',
  '("Tangier" OR "Casablanca" OR "Kenitra" OR "Jorf Lasfar" OR "Mohammedia" OR "Sfax" OR "Sousse" OR "Bizerte" OR "Misrata" OR "Benghazi")',
  '("Special Economic Zone" OR "industrial park" OR "tech park" OR "logistics hub" OR "container terminal" OR "transshipment hub")',
  '("EV adoption" OR "green hydrogen" OR "carbon capture" OR "renewables target" OR "nuclear plant" OR "SMR reactor")',
];

async function pullGDELTQuery(q: string): Promise<RawSignal[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=75&format=json&sort=DateDesc&timespan=24h`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`GDELT HTTP ${r.status} for ${q.slice(0,40)}`);
  const text = await r.text();
  if (!text.trim().startsWith("{")) return [];
  const j = JSON.parse(text);
  const articles = (j.articles || []) as any[];
  return articles.map((a) => {
    const iso3 = (a.sourcecountry || "").toUpperCase().slice(0, 3) || null;
    return {
      source_type: "aggregator",
      source_name: a.domain || "gdelt",
      source_reliability: 0.6,
      raw_text: a.title || "",
      raw_payload: a,
      language: (a.language || "en").toLowerCase().slice(0, 2),
      url: a.url || null,
      published_at: a.seendate ? parseGDELTDate(a.seendate) : null,
      country_hint: iso3 && iso3.length === 3 ? iso3 : null,
      region_hint: null,
      dedup_key: `gdelt_${hash(a.url || a.title || crypto.randomUUID())}`,
    } satisfies RawSignal;
  });
}

async function pullGDELT(): Promise<RawSignal[]> {
  // Parallelize in batches of 4 to keep total runtime under function timeout.
  const all: RawSignal[] = [];
  const BATCH_SIZE = 4;
  for (let i = 0; i < GDELT_QUERIES.length; i += BATCH_SIZE) {
    const batch = GDELT_QUERIES.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(pullGDELTQuery));
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
      else console.warn(`gdelt skip: ${r.reason?.message || r.reason}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  return all;
}

async function pullReliefWeb(): Promise<RawSignal[]> {
  // ReliefWeb v2 POST API. Open, no key.
  const url = "https://api.reliefweb.int/v2/reports?appname=aicis-lril";
  const fromIso = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  const body = {
    limit: 100,
    sort: ["date.created:desc"],
    filter: { field: "date.created", value: { from: fromIso } },
    fields: { include: ["title","body","date","url","primary_country","disaster_type","theme"] },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`ReliefWeb HTTP ${r.status}`);
  const j = await r.json();
  const data = (j.data || []) as any[];
  const out: RawSignal[] = [];
  for (const d of data) {
    const f = d.fields || {};
    const iso3 = f.primary_country?.iso3?.toUpperCase() || null;
    const title = f.title || "";
    const bodyText = (f.body || "").replace(/<[^>]+>/g, " ").slice(0, 1500);
    out.push({
      source_type: "ngo",
      source_name: "reliefweb",
      source_reliability: 0.9,
      raw_text: `${title}. ${bodyText}`,
      raw_payload: { id: d.id, url: f.url, country: f.primary_country?.name, disaster_type: f.disaster_type },
      language: "en",
      url: f.url || null,
      published_at: f.date?.created || null,
      country_hint: iso3,
      region_hint: f.primary_country?.name || null,
      dedup_key: `reliefweb_${d.id}`,
    });
  }
  return out;
}

function parseGDELTDate(s: string): string | null {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

async function pullGDACS(): Promise<RawSignal[]> {
  // GDACS — Global Disaster Alert (EU JRC). Open, no key, no rate limit.
  const url = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Green;Orange;Red";
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`GDACS HTTP ${r.status}`);
  const j = await r.json();
  const features = (j.features || []) as any[];
  return features.map((f) => {
    const p = f.properties || {};
    const eventType = (p.eventtype || "disaster").toString();
    const text = (p.name || p.htmldescription || `GDACS ${eventType}`).toString();
    return {
      source_type: "ngo",
      source_name: "gdacs",
      source_reliability: 0.92,
      raw_text: text,
      raw_payload: p,
      language: "en",
      url: p.url?.report || null,
      published_at: p.fromdate || null,
      country_hint: (p.iso3 || "").toUpperCase().slice(0, 3) || null,
      region_hint: p.country || null,
      dedup_key: `gdacs_${p.eventid || p.episodeid || hash(p.url?.report || text)}`,
    } satisfies RawSignal;
  });
}

async function pullUSGS(): Promise<RawSignal[]> {
  // USGS earthquakes M4.5+ past day — ground truth seismic events worldwide.
  const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`USGS HTTP ${r.status}`);
  const j = await r.json();
  const features = (j.features || []) as any[];
  return features.map((f) => {
    const p = f.properties || {};
    const c = f.geometry?.coordinates || [];
    const text = `M${p.mag} earthquake — ${p.place || "unknown"}`;
    return {
      source_type: "sensor",
      source_name: "usgs",
      source_reliability: 0.98,
      raw_text: text,
      raw_payload: { ...p, coordinates: c },
      language: "en",
      url: p.url || null,
      published_at: p.time ? new Date(p.time).toISOString() : null,
      country_hint: null,
      region_hint: p.place || null,
      dedup_key: `usgs_${f.id}`,
    } satisfies RawSignal;
  });
}

async function pullEONET(): Promise<RawSignal[]> {
  // NASA EONET — wildfires, volcanoes, severe storms, floods (open events).
  const url = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=3&limit=200";
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`EONET HTTP ${r.status}`);
  const j = await r.json();
  const events = (j.events || []) as any[];
  return events.map((e) => {
    const cat = e.categories?.[0]?.title || "natural event";
    const geom = e.geometry?.[e.geometry.length - 1] || {};
    return {
      source_type: "sensor",
      source_name: "nasa_eonet",
      source_reliability: 0.95,
      raw_text: `${cat}: ${e.title}`,
      raw_payload: { ...e, last_geom: geom },
      language: "en",
      url: e.sources?.[0]?.url || null,
      published_at: geom.date || null,
      country_hint: null,
      region_hint: null,
      dedup_key: `eonet_${e.id}`,
    } satisfies RawSignal;
  });
}

// v4: Local & regional RSS — fills gaps in Pacific, West Africa, Sahel, Horn, SE Asia, Latin America
const LOCAL_RSS: { url: string; name: string; iso3: string | null; reliability: number }[] = [
  { url: "https://www.rnz.co.nz/rss/pacific.xml", name: "rnz_pacific", iso3: null, reliability: 0.85 },
  { url: "https://www.abc.net.au/news/feed/8841608/rss.xml", name: "abc_pacific", iso3: null, reliability: 0.85 },
  { url: "https://www.thenational.com.pg/feed/", name: "thenational_png", iso3: "PNG", reliability: 0.78 },
  { url: "https://postcourier.com.pg/feed/", name: "postcourier_png", iso3: "PNG", reliability: 0.78 },
  { url: "https://www.looppng.com/rss.xml", name: "loop_png", iso3: "PNG", reliability: 0.72 },
  { url: "https://www.fijitimes.com.fj/feed/", name: "fiji_times", iso3: "FJI", reliability: 0.75 },
  { url: "https://www.solomonstarnews.com/feed/", name: "solomon_star", iso3: "SLB", reliability: 0.72 },
  { url: "https://www.dailypost.vu/search/?f=rss", name: "vanuatu_dailypost", iso3: "VUT", reliability: 0.72 },
  { url: "https://www.premiumtimesng.com/feed", name: "premium_times_ng", iso3: "NGA", reliability: 0.82 },
  { url: "https://dailytrust.com/feed/", name: "daily_trust_ng", iso3: "NGA", reliability: 0.78 },
  { url: "https://humanglemedia.com/feed/", name: "humangle", iso3: "NGA", reliability: 0.85 },
  { url: "https://www.graphic.com.gh/feed/", name: "graphic_gh", iso3: "GHA", reliability: 0.78 },
  { url: "https://addisstandard.com/feed/", name: "addis_standard", iso3: "ETH", reliability: 0.82 },
  { url: "https://www.standardmedia.co.ke/rss/headlines.php", name: "standard_ke", iso3: "KEN", reliability: 0.78 },
  { url: "https://www.frontiermyanmar.net/en/feed/", name: "frontier_mm", iso3: "MMR", reliability: 0.85 },
  { url: "https://www.rappler.com/feed/", name: "rappler_ph", iso3: "PHL", reliability: 0.8 },
  { url: "https://www.semana.com/rss/portada.xml", name: "semana_co", iso3: "COL", reliability: 0.75 },
  { url: "https://www.eluniversal.com.mx/rss.xml", name: "eluniversal_mx", iso3: "MEX", reliability: 0.75 },
];

function stripXml(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function pullRSSFeed(feed: typeof LOCAL_RSS[number]): Promise<RawSignal[]> {
  try {
    const r = await fetch(feed.url, {
      headers: { "User-Agent": "AICIS-LRIL/4.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
    const out: RawSignal[] = [];
    for (const it of items.slice(0, 30)) {
      const title = stripXml((it.match(/<title>([\s\S]*?)<\/title>/i) || [, ""])[1]);
      const desc = stripXml((it.match(/<description>([\s\S]*?)<\/description>/i) || it.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [, ""])[1]).slice(0, 800);
      const link = (it.match(/<link[^>]*>([^<]+)<\/link>/i) || it.match(/<link[^>]*href="([^"]+)"/i) || [, ""])[1].trim();
      const pub = (it.match(/<pubDate>([^<]+)<\/pubDate>/i) || it.match(/<published>([^<]+)<\/published>/i) || it.match(/<updated>([^<]+)<\/updated>/i) || [, ""])[1];
      if (!title) continue;
      out.push({
        source_type: "news",
        source_name: feed.name,
        source_reliability: feed.reliability,
        raw_text: desc ? `${title}. ${desc}` : title,
        raw_payload: { title, desc, link, feed: feed.name },
        language: "en",
        url: link || null,
        published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
        country_hint: feed.iso3,
        region_hint: null,
        dedup_key: `rss_${feed.name}_${hash(link || title)}`,
      });
    }
    return out;
  } catch (_) {
    return [];
  }
}

async function pullLocalRSS(): Promise<RawSignal[]> {
  const all: RawSignal[] = [];
  const BATCH = 5;
  for (let i = 0; i < LOCAL_RSS.length; i += BATCH) {
    const batch = LOCAL_RSS.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(pullRSSFeed));
    for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
    await new Promise(r => setTimeout(r, 400));
  }
  return all;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const start = Date.now();
  const summary: Record<string, number | string> = {};
  const all: RawSignal[] = [];

  // Optional caller-supplied items
  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (Array.isArray(body?.items)) {
        for (const it of body.items) {
          all.push({
            source_type: it.source_type || "news",
            source_name: it.source_name || body.source_name || "custom",
            source_reliability: typeof it.source_reliability === "number" ? it.source_reliability : 0.6,
            raw_text: it.raw_text || it.text || "",
            raw_payload: it.raw_payload || it,
            language: (it.language || "en").toLowerCase().slice(0, 2),
            url: it.url || null,
            published_at: it.published_at || new Date().toISOString(),
            country_hint: it.country_hint || it.iso3 || null,
            region_hint: it.region_hint || null,
            dedup_key: it.dedup_key || `custom_${hash(it.url || it.raw_text || crypto.randomUUID())}`,
          });
        }
        summary.custom = body.items.length;
      }
    } catch (_) { /* ignore */ }
  }

  // v4: run all sources in parallel — slow GDELT 429s never block local RSS / sensors.
  const tasks: Array<[string, Promise<RawSignal[]>]> = [
    ["gdacs", pullGDACS()],
    ["gdelt", pullGDELT()],
    ["reliefweb", pullReliefWeb()],
    ["usgs", pullUSGS()],
    ["eonet", pullEONET()],
    ["local_rss", pullLocalRSS()],
  ];
  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  settled.forEach((res, i) => {
    const [name] = tasks[i];
    if (res.status === "fulfilled") {
      all.push(...res.value);
      summary[name] = res.value.length;
    } else {
      summary[`${name}_error`] = (res.reason as Error)?.message || String(res.reason);
    }
  });

  let inserted = 0;
  if (all.length > 0) {
    // Chunked upsert
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500);
      const { data, error } = await supabase
        .from("aicis_raw_local_signals")
        .upsert(chunk, { onConflict: "dedup_key", ignoreDuplicates: true })
        .select("id");
      if (error) { summary.insert_error = error.message; break; }
      inserted += data?.length || 0;
    }
  }

  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: summary.insert_error ? "error" : "success",
    message: `Ingested ${inserted}/${all.length} signals. ${JSON.stringify(summary)} (${Date.now() - start}ms)`,
  });

  return new Response(JSON.stringify({ ok: true, inserted, sourced: all.length, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
