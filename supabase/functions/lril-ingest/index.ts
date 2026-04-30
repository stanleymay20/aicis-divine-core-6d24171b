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
  // v5: Maghreb + Egypt + Sudan + Libya
  { url: "https://www.aps.dz/spip.php?page=backend-fr", name: "aps_dz", iso3: "DZA", reliability: 0.88 },
  { url: "https://www.tsa-algerie.com/feed/", name: "tsa_dz", iso3: "DZA", reliability: 0.82 },
  { url: "https://www.echoroukonline.com/feed", name: "echorouk_dz", iso3: "DZA", reliability: 0.75 },
  { url: "https://www.elwatan-dz.com/feed", name: "elwatan_dz", iso3: "DZA", reliability: 0.8 },
  { url: "https://www.mapnews.ma/en/rss.xml", name: "map_ma", iso3: "MAR", reliability: 0.85 },
  { url: "https://en.hespress.com/feed", name: "hespress_ma", iso3: "MAR", reliability: 0.78 },
  { url: "https://www.tap.info.tn/en/rss-en", name: "tap_tn", iso3: "TUN", reliability: 0.85 },
  { url: "https://www.libyaobserver.ly/rss.xml", name: "libya_observer", iso3: "LBY", reliability: 0.78 },
  { url: "https://sudantribune.com/feed/", name: "sudan_tribune", iso3: "SDN", reliability: 0.82 },
  { url: "https://www.egyptindependent.com/feed/", name: "egypt_independent", iso3: "EGY", reliability: 0.78 },
  { url: "https://www.madamasr.com/en/feed/", name: "mada_masr", iso3: "EGY", reliability: 0.85 },
  // v5: Latin America + Asia gaps
  { url: "https://feeds.folha.uol.com.br/folha/rss091.xml", name: "folha_br", iso3: "BRA", reliability: 0.82 },
  { url: "https://www.clarin.com/rss/lo-ultimo/", name: "clarin_ar", iso3: "ARG", reliability: 0.78 },
  { url: "https://www.bangkokpost.com/rss/data/topstories.xml", name: "bangkok_post", iso3: "THA", reliability: 0.8 },
  { url: "https://e.vnexpress.net/rss/news.rss", name: "vnexpress", iso3: "VNM", reliability: 0.78 },
  { url: "https://www.thejakartapost.com/rss", name: "jakarta_post", iso3: "IDN", reliability: 0.78 },
  { url: "https://www.dawn.com/feeds/home", name: "dawn_pk", iso3: "PAK", reliability: 0.82 },
  { url: "https://www.thedailystar.net/frontpage/rss.xml", name: "dailystar_bd", iso3: "BGD", reliability: 0.78 },
  { url: "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf", name: "allafrica", iso3: null, reliability: 0.78 },
  { url: "https://www.france24.com/en/africa/rss", name: "france24_africa", iso3: null, reliability: 0.85 },
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

// v6: Google News RSS — universal local-news coverage for every country.
// Each country has its own (hl=lang, gl=country, ceid=country:lang) edition,
// returning genuine local outlets in the local language. No API key required.
// This closes the "all locals everywhere" gap: 200+ countries get hyperlocal
// news ingestion automatically without hand-curating individual RSS feeds.
const GOOGLE_NEWS_LOCALES: Array<{ iso3: string; hl: string; gl: string }> = [
  // Africa
  { iso3: "DZA", hl: "fr", gl: "DZ" }, { iso3: "AGO", hl: "pt", gl: "AO" },
  { iso3: "BEN", hl: "fr", gl: "BJ" }, { iso3: "BWA", hl: "en", gl: "BW" },
  { iso3: "BFA", hl: "fr", gl: "BF" }, { iso3: "BDI", hl: "fr", gl: "BI" },
  { iso3: "CMR", hl: "fr", gl: "CM" }, { iso3: "CPV", hl: "pt", gl: "CV" },
  { iso3: "CAF", hl: "fr", gl: "CF" }, { iso3: "TCD", hl: "fr", gl: "TD" },
  { iso3: "COM", hl: "fr", gl: "KM" }, { iso3: "COD", hl: "fr", gl: "CD" },
  { iso3: "COG", hl: "fr", gl: "CG" }, { iso3: "CIV", hl: "fr", gl: "CI" },
  { iso3: "DJI", hl: "fr", gl: "DJ" }, { iso3: "EGY", hl: "ar", gl: "EG" },
  { iso3: "GNQ", hl: "es", gl: "GQ" }, { iso3: "ERI", hl: "en", gl: "ER" },
  { iso3: "SWZ", hl: "en", gl: "SZ" }, { iso3: "ETH", hl: "en", gl: "ET" },
  { iso3: "GAB", hl: "fr", gl: "GA" }, { iso3: "GMB", hl: "en", gl: "GM" },
  { iso3: "GHA", hl: "en", gl: "GH" }, { iso3: "GIN", hl: "fr", gl: "GN" },
  { iso3: "GNB", hl: "pt", gl: "GW" }, { iso3: "KEN", hl: "en", gl: "KE" },
  { iso3: "LSO", hl: "en", gl: "LS" }, { iso3: "LBR", hl: "en", gl: "LR" },
  { iso3: "LBY", hl: "ar", gl: "LY" }, { iso3: "MDG", hl: "fr", gl: "MG" },
  { iso3: "MWI", hl: "en", gl: "MW" }, { iso3: "MLI", hl: "fr", gl: "ML" },
  { iso3: "MRT", hl: "ar", gl: "MR" }, { iso3: "MUS", hl: "en", gl: "MU" },
  { iso3: "MAR", hl: "fr", gl: "MA" }, { iso3: "MOZ", hl: "pt", gl: "MZ" },
  { iso3: "NAM", hl: "en", gl: "NA" }, { iso3: "NER", hl: "fr", gl: "NE" },
  { iso3: "NGA", hl: "en", gl: "NG" }, { iso3: "RWA", hl: "en", gl: "RW" },
  { iso3: "STP", hl: "pt", gl: "ST" }, { iso3: "SEN", hl: "fr", gl: "SN" },
  { iso3: "SYC", hl: "en", gl: "SC" }, { iso3: "SLE", hl: "en", gl: "SL" },
  { iso3: "SOM", hl: "en", gl: "SO" }, { iso3: "ZAF", hl: "en", gl: "ZA" },
  { iso3: "SSD", hl: "en", gl: "SS" }, { iso3: "SDN", hl: "ar", gl: "SD" },
  { iso3: "TZA", hl: "en", gl: "TZ" }, { iso3: "TGO", hl: "fr", gl: "TG" },
  { iso3: "TUN", hl: "ar", gl: "TN" }, { iso3: "UGA", hl: "en", gl: "UG" },
  { iso3: "ZMB", hl: "en", gl: "ZM" }, { iso3: "ZWE", hl: "en", gl: "ZW" },
  // Americas
  { iso3: "ARG", hl: "es", gl: "AR" }, { iso3: "BHS", hl: "en", gl: "BS" },
  { iso3: "BRB", hl: "en", gl: "BB" }, { iso3: "BLZ", hl: "en", gl: "BZ" },
  { iso3: "BOL", hl: "es", gl: "BO" }, { iso3: "BRA", hl: "pt", gl: "BR" },
  { iso3: "CAN", hl: "en", gl: "CA" }, { iso3: "CHL", hl: "es", gl: "CL" },
  { iso3: "COL", hl: "es", gl: "CO" }, { iso3: "CRI", hl: "es", gl: "CR" },
  { iso3: "CUB", hl: "es", gl: "CU" }, { iso3: "DOM", hl: "es", gl: "DO" },
  { iso3: "ECU", hl: "es", gl: "EC" }, { iso3: "SLV", hl: "es", gl: "SV" },
  { iso3: "GTM", hl: "es", gl: "GT" }, { iso3: "GUY", hl: "en", gl: "GY" },
  { iso3: "HTI", hl: "fr", gl: "HT" }, { iso3: "HND", hl: "es", gl: "HN" },
  { iso3: "JAM", hl: "en", gl: "JM" }, { iso3: "MEX", hl: "es", gl: "MX" },
  { iso3: "NIC", hl: "es", gl: "NI" }, { iso3: "PAN", hl: "es", gl: "PA" },
  { iso3: "PRY", hl: "es", gl: "PY" }, { iso3: "PER", hl: "es", gl: "PE" },
  { iso3: "TTO", hl: "en", gl: "TT" }, { iso3: "USA", hl: "en", gl: "US" },
  { iso3: "URY", hl: "es", gl: "UY" }, { iso3: "VEN", hl: "es", gl: "VE" },
  // Asia
  { iso3: "AFG", hl: "en", gl: "AF" }, { iso3: "ARM", hl: "hy", gl: "AM" },
  { iso3: "AZE", hl: "az", gl: "AZ" }, { iso3: "BHR", hl: "ar", gl: "BH" },
  { iso3: "BGD", hl: "en", gl: "BD" }, { iso3: "BTN", hl: "en", gl: "BT" },
  { iso3: "BRN", hl: "en", gl: "BN" }, { iso3: "KHM", hl: "en", gl: "KH" },
  { iso3: "CHN", hl: "zh", gl: "CN" }, { iso3: "GEO", hl: "ka", gl: "GE" },
  { iso3: "HKG", hl: "en", gl: "HK" }, { iso3: "IND", hl: "en", gl: "IN" },
  { iso3: "IDN", hl: "id", gl: "ID" }, { iso3: "IRN", hl: "fa", gl: "IR" },
  { iso3: "IRQ", hl: "ar", gl: "IQ" }, { iso3: "ISR", hl: "he", gl: "IL" },
  { iso3: "JPN", hl: "ja", gl: "JP" }, { iso3: "JOR", hl: "ar", gl: "JO" },
  { iso3: "KAZ", hl: "ru", gl: "KZ" }, { iso3: "KWT", hl: "ar", gl: "KW" },
  { iso3: "KGZ", hl: "ru", gl: "KG" }, { iso3: "LAO", hl: "en", gl: "LA" },
  { iso3: "LBN", hl: "ar", gl: "LB" }, { iso3: "MYS", hl: "en", gl: "MY" },
  { iso3: "MDV", hl: "en", gl: "MV" }, { iso3: "MNG", hl: "en", gl: "MN" },
  { iso3: "MMR", hl: "en", gl: "MM" }, { iso3: "NPL", hl: "en", gl: "NP" },
  { iso3: "PRK", hl: "en", gl: "KP" }, { iso3: "OMN", hl: "ar", gl: "OM" },
  { iso3: "PAK", hl: "en", gl: "PK" }, { iso3: "PSE", hl: "ar", gl: "PS" },
  { iso3: "PHL", hl: "en", gl: "PH" }, { iso3: "QAT", hl: "ar", gl: "QA" },
  { iso3: "SAU", hl: "ar", gl: "SA" }, { iso3: "SGP", hl: "en", gl: "SG" },
  { iso3: "KOR", hl: "ko", gl: "KR" }, { iso3: "LKA", hl: "en", gl: "LK" },
  { iso3: "SYR", hl: "ar", gl: "SY" }, { iso3: "TWN", hl: "zh", gl: "TW" },
  { iso3: "TJK", hl: "ru", gl: "TJ" }, { iso3: "THA", hl: "th", gl: "TH" },
  { iso3: "TLS", hl: "en", gl: "TL" }, { iso3: "TUR", hl: "tr", gl: "TR" },
  { iso3: "TKM", hl: "ru", gl: "TM" }, { iso3: "ARE", hl: "ar", gl: "AE" },
  { iso3: "UZB", hl: "ru", gl: "UZ" }, { iso3: "VNM", hl: "vi", gl: "VN" },
  { iso3: "YEM", hl: "ar", gl: "YE" },
  // Europe
  { iso3: "ALB", hl: "sq", gl: "AL" }, { iso3: "AND", hl: "es", gl: "AD" },
  { iso3: "AUT", hl: "de", gl: "AT" }, { iso3: "BLR", hl: "ru", gl: "BY" },
  { iso3: "BEL", hl: "fr", gl: "BE" }, { iso3: "BIH", hl: "en", gl: "BA" },
  { iso3: "BGR", hl: "bg", gl: "BG" }, { iso3: "HRV", hl: "hr", gl: "HR" },
  { iso3: "CYP", hl: "en", gl: "CY" }, { iso3: "CZE", hl: "cs", gl: "CZ" },
  { iso3: "DNK", hl: "da", gl: "DK" }, { iso3: "EST", hl: "et", gl: "EE" },
  { iso3: "FIN", hl: "fi", gl: "FI" }, { iso3: "FRA", hl: "fr", gl: "FR" },
  { iso3: "DEU", hl: "de", gl: "DE" }, { iso3: "GRC", hl: "el", gl: "GR" },
  { iso3: "HUN", hl: "hu", gl: "HU" }, { iso3: "ISL", hl: "is", gl: "IS" },
  { iso3: "IRL", hl: "en", gl: "IE" }, { iso3: "ITA", hl: "it", gl: "IT" },
  { iso3: "XKX", hl: "en", gl: "XK" }, { iso3: "LVA", hl: "lv", gl: "LV" },
  { iso3: "LIE", hl: "de", gl: "LI" }, { iso3: "LTU", hl: "lt", gl: "LT" },
  { iso3: "LUX", hl: "fr", gl: "LU" }, { iso3: "MLT", hl: "en", gl: "MT" },
  { iso3: "MDA", hl: "ro", gl: "MD" }, { iso3: "MCO", hl: "fr", gl: "MC" },
  { iso3: "MNE", hl: "en", gl: "ME" }, { iso3: "NLD", hl: "nl", gl: "NL" },
  { iso3: "MKD", hl: "en", gl: "MK" }, { iso3: "NOR", hl: "no", gl: "NO" },
  { iso3: "POL", hl: "pl", gl: "PL" }, { iso3: "PRT", hl: "pt", gl: "PT" },
  { iso3: "ROU", hl: "ro", gl: "RO" }, { iso3: "RUS", hl: "ru", gl: "RU" },
  { iso3: "SMR", hl: "it", gl: "SM" }, { iso3: "SRB", hl: "sr", gl: "RS" },
  { iso3: "SVK", hl: "sk", gl: "SK" }, { iso3: "SVN", hl: "sl", gl: "SI" },
  { iso3: "ESP", hl: "es", gl: "ES" }, { iso3: "SWE", hl: "sv", gl: "SE" },
  { iso3: "CHE", hl: "de", gl: "CH" }, { iso3: "UKR", hl: "uk", gl: "UA" },
  { iso3: "GBR", hl: "en", gl: "GB" },
  // Oceania
  { iso3: "AUS", hl: "en", gl: "AU" }, { iso3: "FJI", hl: "en", gl: "FJ" },
  { iso3: "KIR", hl: "en", gl: "KI" }, { iso3: "MHL", hl: "en", gl: "MH" },
  { iso3: "FSM", hl: "en", gl: "FM" }, { iso3: "NRU", hl: "en", gl: "NR" },
  { iso3: "NZL", hl: "en", gl: "NZ" }, { iso3: "PLW", hl: "en", gl: "PW" },
  { iso3: "PNG", hl: "en", gl: "PG" }, { iso3: "WSM", hl: "en", gl: "WS" },
  { iso3: "SLB", hl: "en", gl: "SB" }, { iso3: "TON", hl: "en", gl: "TO" },
  { iso3: "TUV", hl: "en", gl: "TV" }, { iso3: "VUT", hl: "en", gl: "VU" },
];

async function pullGoogleNewsLocale(loc: typeof GOOGLE_NEWS_LOCALES[number]): Promise<RawSignal[]> {
  // Top stories for the country's local edition — returns local outlets in local language.
  const url = `https://news.google.com/rss?hl=${loc.hl}&gl=${loc.gl}&ceid=${loc.gl}:${loc.hl}`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "AICIS-LRIL/6.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    const out: RawSignal[] = [];
    for (const it of items.slice(0, 25)) {
      const title = stripXml((it.match(/<title>([\s\S]*?)<\/title>/i) || [, ""])[1]);
      const desc = stripXml((it.match(/<description>([\s\S]*?)<\/description>/i) || [, ""])[1]).slice(0, 600);
      const link = (it.match(/<link[^>]*>([^<]+)<\/link>/i) || [, ""])[1].trim();
      const pub = (it.match(/<pubDate>([^<]+)<\/pubDate>/i) || [, ""])[1];
      const sourceMatch = it.match(/<source[^>]*>([^<]+)<\/source>/i);
      const sourceName = sourceMatch ? stripXml(sourceMatch[1]).toLowerCase().replace(/\s+/g, "_").slice(0, 40) : `gnews_${loc.gl}`;
      if (!title) continue;
      out.push({
        source_type: "news",
        source_name: `gnews_${loc.gl}_${sourceName}`.slice(0, 60),
        source_reliability: 0.72,
        raw_text: desc ? `${title}. ${desc}` : title,
        raw_payload: { title, desc, link, locale: loc, source: sourceName },
        language: loc.hl,
        url: link || null,
        published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
        country_hint: loc.iso3,
        region_hint: null,
        dedup_key: `gnews_${loc.iso3}_${hash(link || title)}`,
      });
    }
    return out;
  } catch (_) {
    return [];
  }
}

async function pullGoogleNewsAllCountries(): Promise<RawSignal[]> {
  // Rotate through 25 countries per run (full cycle ~every 3h at 30-min cadence).
  // Prioritize countries with low recent news signal — same logic as country-sweep.
  const PER_RUN = 25;
  const BATCH = 6;
  const shuffled = [...GOOGLE_NEWS_LOCALES].sort(() => Math.random() - 0.5).slice(0, PER_RUN);
  const all: RawSignal[] = [];
  for (let i = 0; i < shuffled.length; i += BATCH) {
    const batch = shuffled.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(pullGoogleNewsLocale));
    for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
    await new Promise(r => setTimeout(r, 300));
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
    ["google_news", pullGoogleNewsAllCountries()],
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
