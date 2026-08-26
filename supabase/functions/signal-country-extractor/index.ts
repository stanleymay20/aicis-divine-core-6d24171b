import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
// signal-country-extractor (v2 — Phase 3.6)
// Extract ISO3 country codes from signal title/summary/translated_*.
//
// v2 improvements over v1:
//  - Domain-based source hints (nbcnews.com → USA, bbc.co.uk → GBR, etc.)
//  - ccTLD fallback (.fr/.de/.uk/.in/...)
//  - Major-city lookup from aicis_geo_entities (population >= 500k), with
//    automatic ambiguity detection (city names that map to >1 ISO3 lose weight)
//  - Hard ambiguity guards on Washington / Georgia / Jordan / Alexandria / etc.
//    These are only counted when corroborated by another in-text signal or by
//    a matching domain hint.
//  - Minimum confidence floor (>= 30) to write affected_countries
//
// Idempotent. Safe to re-run. Method tag bumps to alias_dictionary_v2.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH = 250;
const MIN_CONFIDENCE = 30;

// Static demonym/alias map (unambiguous aliases only). Ambiguous aliases
// like "washington", "georgia", "jordan" live in AMBIGUOUS_ALIASES below.
const ALIASES: Record<string, string> = {
  // EN demonyms / aliases
  "american": "USA", "americans": "USA", "u.s.": "USA",
  "u.s.a": "USA", "united states": "USA",
  "british": "GBR", "u.k.": "GBR", "england": "GBR",
  "scotland": "GBR", "wales": "GBR",
  "french": "FRA", "france": "FRA",
  "german": "DEU", "germany": "DEU",
  "spanish": "ESP",
  "italian": "ITA", "italy": "ITA",
  "russian": "RUS", "russia": "RUS", "kremlin": "RUS",
  "chinese": "CHN", "china": "CHN",
  "japanese": "JPN", "japan": "JPN",
  "korean": "KOR", "south korea": "KOR",
  "north korea": "PRK", "pyongyang": "PRK", "dprk": "PRK",
  "indian": "IND", "india": "IND", "new delhi": "IND",
  "pakistani": "PAK", "pakistan": "PAK", "islamabad": "PAK",
  "bangladeshi": "BGD", "bangladesh": "BGD", "dhaka": "BGD",
  "indonesian": "IDN", "indonesia": "IDN", "jakarta": "IDN",
  "turkish": "TUR", "turkey": "TUR", "ankara": "TUR", "türkiye": "TUR",
  "iranian": "IRN", "iran": "IRN", "tehran": "IRN",
  "iraqi": "IRQ", "iraq": "IRQ", "baghdad": "IRQ",
  "syrian": "SYR", "syria": "SYR", "damascus": "SYR",
  "israeli": "ISR", "israel": "ISR", "jerusalem": "ISR",
  "palestinian": "PSE", "palestine": "PSE", "gaza": "PSE", "west bank": "PSE",
  "saudi": "SAU", "saudi arabia": "SAU", "riyadh": "SAU",
  "emirati": "ARE", "uae": "ARE", "abu dhabi": "ARE",
  "egyptian": "EGY", "egypt": "EGY", "cairo": "EGY",
  "ukrainian": "UKR", "ukraine": "UKR", "kyiv": "UKR", "kiev": "UKR",
  "polish": "POL", "poland": "POL", "warsaw": "POL",
  "dutch": "NLD", "netherlands": "NLD", "the hague": "NLD",
  "belgian": "BEL", "belgium": "BEL", "brussels": "BEL",
  "swiss": "CHE", "switzerland": "CHE", "zurich": "CHE", "bern": "CHE",
  "swedish": "SWE", "sweden": "SWE", "stockholm": "SWE",
  "norwegian": "NOR", "norway": "NOR", "oslo": "NOR",
  "danish": "DNK", "denmark": "DNK", "copenhagen": "DNK",
  "finnish": "FIN", "finland": "FIN", "helsinki": "FIN",
  "greek": "GRC", "greece": "GRC",
  "portuguese": "PRT", "portugal": "PRT", "lisbon": "PRT",
  "brazilian": "BRA", "brazil": "BRA", "brasília": "BRA", "brasilia": "BRA",
  "argentine": "ARG", "argentinian": "ARG", "argentina": "ARG", "buenos aires": "ARG",
  "mexican": "MEX", "mexico city": "MEX",
  "colombian": "COL", "colombia": "COL", "bogota": "COL", "bogotá": "COL",
  "venezuelan": "VEN", "venezuela": "VEN", "caracas": "VEN",
  "chilean": "CHL", "chile": "CHL", "santiago": "CHL",
  "peruvian": "PER", "peru": "PER",
  "canadian": "CAN", "canada": "CAN", "ottawa": "CAN", "toronto": "CAN",
  "australian": "AUS", "australia": "AUS", "canberra": "AUS", "sydney": "AUS",
  "new zealand": "NZL", "wellington": "NZL", "auckland": "NZL",
  "south african": "ZAF", "south africa": "ZAF", "johannesburg": "ZAF", "pretoria": "ZAF", "cape town": "ZAF",
  "nigerian": "NGA", "nigeria": "NGA", "lagos": "NGA",
  "kenyan": "KEN", "kenya": "KEN", "nairobi": "KEN",
  "ethiopian": "ETH", "ethiopia": "ETH", "addis ababa": "ETH",
  "ghanaian": "GHA", "ghana": "GHA", "accra": "GHA",
  "moroccan": "MAR", "morocco": "MAR", "rabat": "MAR",
  "algerian": "DZA", "algeria": "DZA",
  "tunisian": "TUN", "tunisia": "TUN", "tunis": "TUN",
  "libyan": "LBY", "libya": "LBY", "tripoli": "LBY",
  "sudanese": "SDN", "sudan": "SDN", "khartoum": "SDN",
  "afghan": "AFG", "afghanistan": "AFG", "kabul": "AFG",
  "yemeni": "YEM", "yemen": "YEM", "sanaa": "YEM",
  "lebanese": "LBN", "lebanon": "LBN", "beirut": "LBN",
  "jordanian": "JOR", "amman": "JOR",
  "qatari": "QAT", "qatar": "QAT", "doha": "QAT",
  "kuwaiti": "KWT", "kuwait": "KWT",
  "bahraini": "BHR", "bahrain": "BHR", "manama": "BHR",
  "omani": "OMN", "oman": "OMN", "muscat": "OMN",
  "vietnamese": "VNM", "vietnam": "VNM", "hanoi": "VNM",
  "thai": "THA", "thailand": "THA", "bangkok": "THA",
  "malaysian": "MYS", "malaysia": "MYS", "kuala lumpur": "MYS",
  "filipino": "PHL", "philippines": "PHL", "manila": "PHL",
  "singaporean": "SGP", "singapore": "SGP",
  "burmese": "MMR", "myanmar": "MMR", "burma": "MMR", "yangon": "MMR",
  "taiwanese": "TWN", "taiwan": "TWN", "taipei": "TWN",
  "hong kong": "HKG",
  "macau": "MAC", "macao": "MAC",
  "european union": "EUR", "eu": "EUR",
  "états-unis": "USA", "estados unidos": "USA", "alemania": "DEU", "allemagne": "DEU",
  "rusia": "RUS", "russie": "RUS", "chine": "CHN",
};

// Aliases that ALSO refer to common person names, US states, or other
// non-country meanings. Only counted when corroborated.
const AMBIGUOUS_ALIASES: Record<string, string> = {
  "washington": "USA",       // person name + state + DC
  "georgia": "GEO",          // US state + country + person name
  "jordan": "JOR",           // person name + country
  "u.s.": "USA",             // also "us" pronoun — handled separately
  "us": "USA",               // pronoun
  "uk": "GBR",               // sometimes verb/word
  "chad": "TCD",             // person name + country
  "guinea": "GIN",           // also Papua New Guinea / Equatorial Guinea
  "alexandria": "EGY",       // also US city
  "moscow": "RUS",           // also Idaho city — usually safe
  "paris": "FRA",            // also Texas city, person name — usually safe
  "london": "GBR",           // also Ontario / Kentucky — usually safe
  "delhi": "IND",
  "berlin": "DEU",
  "rome": "ITA",
  "madrid": "ESP",
  "tokyo": "JPN",
  "beijing": "CHN",
  "seoul": "KOR",
  "moscow": "RUS",
  "dubai": "ARE",
  "doha": "QAT",
  "istanbul": "TUR",
  "lima": "PER",
};

// Domain → ISO3 hints. Resolved against the source URL host.
// Only used as a CORROBORATING signal (weight 35), never on its own.
const DOMAIN_HINTS: Record<string, string> = {
  // US
  "nbcnews.com": "USA", "cnbc.com": "USA", "cbsnews.com": "USA", "abcnews.go.com": "USA",
  "foxnews.com": "USA", "nytimes.com": "USA", "washingtonpost.com": "USA",
  "wsj.com": "USA", "usatoday.com": "USA", "npr.org": "USA", "cnn.com": "USA",
  "politico.com": "USA", "axios.com": "USA", "bloomberg.com": "USA",
  "businessinsider.com": "USA", "forbes.com": "USA", "newyorker.com": "USA",
  "nypost.com": "USA", "theverge.com": "USA", "techcrunch.com": "USA",
  "arstechnica.com": "USA", "wired.com": "USA", "engadget.com": "USA",
  "gizmodo.com": "USA", "9to5mac.com": "USA", "9to5google.com": "USA",
  "macrumors.com": "USA", "tomsguide.com": "USA", "vogue.com": "USA",
  "variety.com": "USA", "deadline.com": "USA", "kotaku.com": "USA",
  "gamespot.com": "USA", "ign.com": "USA", "polygon.com": "USA",
  "vulture.com": "USA", "hollywoodreporter.com": "USA",
  "investors.com": "USA", "ibtimes.com": "USA", "marketwatch.com": "USA",
  "yahoo.com": "USA", "huffpost.com": "USA", "dailywire.com": "USA",
  "thedailybeast.com": "USA", "buzzfeednews.com": "USA", "vox.com": "USA",
  "slate.com": "USA", "salon.com": "USA", "msnbc.com": "USA",
  "espn.com": "USA", "nbcsports.com": "USA", "thehill.com": "USA",
  "ap.org": "USA", "apnews.com": "USA", "reuters.com": "USA",
  "scitechdaily.com": "USA", "sciencealert.com": "USA",
  "spacenews.com": "USA", "space.com": "USA", "earth.com": "USA",
  "phys.org": "USA", "livescience.com": "USA", "sciencedaily.com": "USA",
  "thedailygalaxy.com": "USA", "slickdeals.net": "USA", "dealnews.com": "USA",
  "newsweek.com": "USA", "people.com": "USA", "ew.com": "USA",
  "cnet.com": "USA", "zdnet.com": "USA", "venturebeat.com": "USA",
  // UK
  "bbc.com": "GBR", "bbc.co.uk": "GBR", "theguardian.com": "GBR",
  "telegraph.co.uk": "GBR", "thetimes.co.uk": "GBR", "ft.com": "GBR",
  "independent.co.uk": "GBR", "dailymail.co.uk": "GBR", "thesun.co.uk": "GBR",
  "mirror.co.uk": "GBR", "sky.com": "GBR", "skynews.com": "GBR",
  "economist.com": "GBR", "nature.com": "GBR",
  // FR / DE / IT / ES
  "lemonde.fr": "FRA", "lefigaro.fr": "FRA", "liberation.fr": "FRA",
  "spiegel.de": "DEU", "faz.net": "DEU", "zeit.de": "DEU", "welt.de": "DEU",
  "corriere.it": "ITA", "repubblica.it": "ITA",
  "elpais.com": "ESP", "elmundo.es": "ESP",
  // RU / UA / TR
  "tass.com": "RUS", "rt.com": "RUS",
  "kyivpost.com": "UKR", "pravda.com.ua": "UKR",
  "hurriyet.com.tr": "TUR", "dailysabah.com": "TUR",
  // IN / PK / BD
  "economictimes.indiatimes.com": "IND", "timesofindia.indiatimes.com": "IND",
  "thehindu.com": "IND", "hindustantimes.com": "IND", "ndtv.com": "IND",
  "indianexpress.com": "IND", "livemint.com": "IND", "moneycontrol.com": "IND",
  "dawn.com": "PAK", "geo.tv": "PAK", "tribune.com.pk": "PAK",
  "thedailystar.net": "BGD",
  // CN / JP / KR
  "scmp.com": "HKG", "chinadaily.com.cn": "CHN", "globaltimes.cn": "CHN",
  "japantimes.co.jp": "JPN", "asahi.com": "JPN", "nhk.or.jp": "JPN",
  "koreaherald.com": "KOR", "koreatimes.co.kr": "KOR",
  // ME
  "aljazeera.com": "QAT", "arabnews.com": "SAU", "thenationalnews.com": "ARE",
  "haaretz.com": "ISR", "timesofisrael.com": "ISR",
  // CA / AU
  "cbc.ca": "CAN", "theglobeandmail.com": "CAN", "thestar.com": "CAN",
  "abc.net.au": "AUS", "smh.com.au": "AUS", "theage.com.au": "AUS",
  // Africa
  "news24.com": "ZAF", "iol.co.za": "ZAF", "businessday.ng": "NGA",
  "punchng.com": "NGA", "nation.africa": "KEN", "the-star.co.ke": "KEN",
  // LatAm
  "globo.com": "BRA", "folha.uol.com.br": "BRA", "uol.com.br": "BRA",
  "clarin.com": "ARG", "lanacion.com.ar": "ARG",
  "eluniversal.com.mx": "MEX",
};

// ccTLD → ISO3 (basic list; weight 25 — corroborating only).
const CCTLD_HINTS: Record<string, string> = {
  "uk": "GBR", "fr": "FRA", "de": "DEU", "it": "ITA", "es": "ESP",
  "nl": "NLD", "be": "BEL", "ch": "CHE", "se": "SWE", "no": "NOR",
  "dk": "DNK", "fi": "FIN", "pl": "POL", "ru": "RUS", "ua": "UKR",
  "tr": "TUR", "in": "IND", "pk": "PAK", "bd": "BGD", "cn": "CHN",
  "jp": "JPN", "kr": "KOR", "tw": "TWN", "hk": "HKG", "sg": "SGP",
  "id": "IDN", "my": "MYS", "ph": "PHL", "th": "THA", "vn": "VNM",
  "br": "BRA", "ar": "ARG", "mx": "MEX", "cl": "CHL", "co": "COL",
  "pe": "PER", "ca": "CAN", "au": "AUS", "nz": "NZL", "za": "ZAF",
  "ng": "NGA", "ke": "KEN", "eg": "EGY", "ma": "MAR", "il": "ISR",
  "sa": "SAU", "ae": "ARE", "qa": "QAT", "ir": "IRN",
};

type CountryRow = { iso3: string; canonical_name: string };
type Candidate = { iso3: string; score: number; matched: string[] };
type CityRow = { city: string; iso3: string; population: number | null };

type Lookups = {
  nameMap: Map<string, { iso3: string; weight: number; label: string }>;
  aliasMap: Map<string, { iso3: string; weight: number; label: string }>;
  ambiguousMap: Map<string, { iso3: string; weight: number; label: string }>;
  cityMap: Map<string, { iso3: string; weight: number; label: string }>; // lowercase city → unique iso3 city
  iso3Set: Set<string>;
};

function buildLookups(countries: CountryRow[], cities: CityRow[]): Lookups {
  const nameMap = new Map<string, { iso3: string; weight: number; label: string }>();
  const aliasMap = new Map<string, { iso3: string; weight: number; label: string }>();
  const ambiguousMap = new Map<string, { iso3: string; weight: number; label: string }>();
  const cityMap = new Map<string, { iso3: string; weight: number; label: string }>();
  const iso3Set = new Set<string>();

  for (const c of countries) {
    if (c.iso3?.length === 3) iso3Set.add(c.iso3);
    if (c.canonical_name && c.canonical_name.length >= 3) {
      nameMap.set(c.canonical_name.toLowerCase(), {
        iso3: c.iso3, weight: 60, label: `name:${c.canonical_name}`,
      });
    }
  }
  for (const [alias, iso3] of Object.entries(ALIASES)) {
    if (alias.length < 2) continue;
    aliasMap.set(alias, {
      iso3, weight: alias.length >= 5 ? 50 : 35, label: `alias:${alias}`,
    });
  }
  for (const [alias, iso3] of Object.entries(AMBIGUOUS_ALIASES)) {
    ambiguousMap.set(alias, { iso3, weight: 20, label: `ambiguous:${alias}` });
  }

  // Build city map. If a city name maps to >1 ISO3, drop it (ambiguous).
  const cityCountryCounts = new Map<string, Set<string>>();
  for (const c of cities) {
    if (!c.city) continue;
    const key = c.city.toLowerCase();
    if (!cityCountryCounts.has(key)) cityCountryCounts.set(key, new Set());
    cityCountryCounts.get(key)!.add(c.iso3);
  }
  for (const c of cities) {
    if (!c.city) continue;
    const key = c.city.toLowerCase();
    if (key.length < 4) continue; // skip very short names
    if (cityCountryCounts.get(key)!.size > 1) continue; // ambiguous across countries
    if (cityMap.has(key)) continue;
    // Skip if this name is also a known alias for a different country
    if (aliasMap.has(key) || ambiguousMap.has(key) || nameMap.has(key)) continue;
    cityMap.set(key, { iso3: c.iso3, weight: 30, label: `city:${c.city}` });
  }

  return { nameMap, aliasMap, ambiguousMap, cityMap, iso3Set };
}

function tokenizeOnce(text: string) {
  const lower = text.toLowerCase();
  const wordsLower = lower.match(/[\p{L}][\p{L}'.-]{0,40}/gu) || [];
  const wordsUpper = text.match(/\b[A-Z]{3}\b/g) || [];
  const lowerTokens = new Set(wordsLower);
  const lowerBigrams = new Set<string>();
  const lowerTrigrams = new Set<string>();
  for (let i = 0; i < wordsLower.length - 1; i++) {
    lowerBigrams.add(`${wordsLower[i]} ${wordsLower[i + 1]}`);
    if (i < wordsLower.length - 2) {
      lowerTrigrams.add(`${wordsLower[i]} ${wordsLower[i + 1]} ${wordsLower[i + 2]}`);
    }
  }
  return { lowerTokens, lowerBigrams, lowerTrigrams, upperTriTokens: new Set(wordsUpper) };
}

function extractDomainHints(urls: string[]): { iso3: string; weight: number; label: string }[] {
  const out: { iso3: string; weight: number; label: string }[] = [];
  for (const u of urls) {
    if (!u) continue;
    let host = "";
    try { host = new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { continue; }
    // Exact domain match
    if (DOMAIN_HINTS[host]) {
      out.push({ iso3: DOMAIN_HINTS[host], weight: 35, label: `domain:${host}` });
      continue;
    }
    // Suffix match (e.g. "edition.cnn.com")
    let matched = false;
    for (const [k, v] of Object.entries(DOMAIN_HINTS)) {
      if (host.endsWith("." + k) || host === k) {
        out.push({ iso3: v, weight: 30, label: `domain:${k}` });
        matched = true; break;
      }
    }
    if (matched) continue;
    // ccTLD
    const tld = host.split(".").pop() || "";
    if (CCTLD_HINTS[tld]) {
      out.push({ iso3: CCTLD_HINTS[tld], weight: 25, label: `cctld:.${tld}` });
    }
  }
  return out;
}

function extractCandidates(text: string, urls: string[], lookups: Lookups): Candidate[] {
  const { nameMap, aliasMap, ambiguousMap, cityMap, iso3Set } = lookups;
  const scores = new Map<string, Candidate>();
  const sourceLabels = new Map<string, Set<string>>(); // iso3 → set of source-types matched
  const bump = (iso3: string, weight: number, label: string, sourceType: string) => {
    const c = scores.get(iso3);
    if (c) {
      c.score += weight;
      if (!c.matched.includes(label) && c.matched.length < 8) c.matched.push(label);
    } else {
      scores.set(iso3, { iso3, score: weight, matched: [label] });
    }
    if (!sourceLabels.has(iso3)) sourceLabels.set(iso3, new Set());
    sourceLabels.get(iso3)!.add(sourceType);
  };

  // 1) Domain / cctld hints (always counted)
  const domainHints = extractDomainHints(urls);
  for (const h of domainHints) bump(h.iso3, h.weight, h.label, "domain");

  if (text) {
    const { lowerTokens, lowerBigrams, lowerTrigrams, upperTriTokens } = tokenizeOnce(text);
    const testPhrase = (phrase: string): boolean => {
      const wc = phrase.split(" ").length;
      if (wc === 1) return lowerTokens.has(phrase);
      if (wc === 2) return lowerBigrams.has(phrase);
      if (wc === 3) return lowerTrigrams.has(phrase);
      return false;
    };

    // 2) Canonical names
    for (const [name, meta] of nameMap) {
      if (testPhrase(name)) bump(meta.iso3, meta.weight, meta.label, "name");
    }
    // 3) Unambiguous aliases
    for (const [alias, meta] of aliasMap) {
      if (testPhrase(alias)) bump(meta.iso3, meta.weight, meta.label, "alias");
    }
    // 4) Major-city lookup
    for (const [city, meta] of cityMap) {
      if (testPhrase(city)) bump(meta.iso3, meta.weight, meta.label, "city");
    }
    // 5) Bare uppercase ISO3 tokens
    for (const tok of upperTriTokens) {
      if (iso3Set.has(tok)) bump(tok, 25, `iso3:${tok}`, "iso3");
    }

    // 6) Ambiguous aliases — only count if same ISO3 already has another source
    //    OR if a domain hint matches the same ISO3.
    for (const [alias, meta] of ambiguousMap) {
      if (!testPhrase(alias)) continue;
      const existing = sourceLabels.get(meta.iso3);
      const corroborated = (existing && existing.size > 0)
        || domainHints.some(d => d.iso3 === meta.iso3);
      if (corroborated) {
        bump(meta.iso3, meta.weight, meta.label + ":corroborated", "ambiguous");
      } else {
        // Record but don't score — keeps explainability without inflating
        bump(meta.iso3, 0, meta.label + ":uncorroborated", "ambiguous_skipped");
      }
    }
  }

  return Array.from(scores.values())
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

function urlsFromSignal(sig: any): string[] {
  const urls: string[] = [];
  const refs = sig.source_references;
  if (Array.isArray(refs)) {
    for (const r of refs) if (r && typeof r.url === "string") urls.push(r.url);
  }
  return urls;
}

Deno.serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let processed = 0, extracted = 0, none = 0, low = 0;
  const extractedIds: string[] = [];

  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const reprocess = url.searchParams.get("reprocess") === "1"; // re-scan rows already marked no_match
    const limit = Math.min(1000, parseInt(url.searchParams.get("limit") || `${BATCH}`, 10));

    // Load canonical countries
    const { data: countries, error: cErr } = await supa
      .from("canonical_country_list")
      .select("iso3,canonical_name")
      .eq("entity_type", "country");
    if (cErr) throw cErr;

    // Load major cities (population >= 500k)
    const { data: cities, error: cityErr } = await supa
      .from("aicis_geo_entities")
      .select("city,iso3,population")
      .gte("population", 500000)
      .not("city", "is", null)
      .limit(20000);
    if (cityErr) throw cityErr;

    const lookups = buildLookups(
      (countries || []) as CountryRow[],
      (cities || []) as CityRow[],
    );

    // Pull batch
    let q = supa
      .from("global_signals")
      .select("id,title,summary,translated_title,translated_summary,affected_countries,country_extraction_method,country_extraction_confidence,country_extraction_status,source_references")
      .or("affected_countries.is.null,affected_countries.eq.{}")
      .order("first_detected_at", { ascending: false })
      .limit(limit);
    if (!reprocess) q = q.is("country_extracted_at", null);
    else q = q.in("country_extraction_status", ["no_match", "skipped_existing"]);

    const { data: pending, error } = await q;
    if (error) throw error;

    for (const sig of pending || []) {
      processed++;
      const text = [sig.translated_title, sig.translated_summary, sig.title, sig.summary]
        .filter(Boolean).join("  ");
      const urls = urlsFromSignal(sig);
      const cands = extractCandidates(text, urls, lookups);

      const update: any = {
        country_extracted_at: new Date().toISOString(),
        last_pipeline_stage: "country_extracted",
        extracted_country_candidates: cands.slice(0, 5),
        country_extraction_method: "alias_dictionary_v2",
      };

      if (cands.length === 0) {
        update.country_extraction_status = "no_match";
        update.country_extraction_confidence = 0;
        none++;
      } else {
        const top = cands[0];
        const confidence = Math.min(100, Math.round(top.score));

        if (confidence < MIN_CONFIDENCE) {
          update.country_extraction_status = "low_confidence";
          update.country_extraction_confidence = confidence;
          low++;
        } else {
          const existingAc = (sig.affected_countries || []) as string[];
          const shouldWrite = force ||
            existingAc.length === 0 ||
            (sig.country_extraction_confidence ?? 0) < confidence;
          if (shouldWrite) {
            update.affected_countries = [top.iso3];
            update.country_extraction_status = "extracted";
            update.country_extraction_confidence = confidence;
            extractedIds.push(sig.id);
            extracted++;
          } else {
            update.country_extraction_status = "skipped_existing";
            update.country_extraction_confidence = confidence;
          }
        }
      }

      const { error: uErr } = await supa.from("global_signals").update(update).eq("id", sig.id);
      if (uErr) throw uErr;
    }

    if (extractedIds.length > 0) {
      await supa
        .from("global_signals")
        .update({ geocoded_at: null })
        .in("id", extractedIds)
        .eq("geo_method", "failed");
    }

    await supa.from("automation_logs").insert({
      job_name: "signal-country-extractor",
      status: "success",
      message: `v2 processed=${processed} extracted=${extracted} low_conf=${low} no_match=${none} in ${Date.now() - startedAt}ms`,
    });
    return new Response(JSON.stringify({ processed, extracted, low_confidence: low, no_match: none }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("signal-country-extractor error:", msg);
    await supa.from("automation_logs").insert({
      job_name: "signal-country-extractor", status: "error", message: msg.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
