// signal-country-extractor
// Phase 3.5 — Extract ISO3 country codes from signal title/summary/translated_*.
//
// Scans signals where affected_countries is empty/null. Matches against:
//  - Canonical country name (canonical_country_list)
//  - ISO3 code (3-letter, must be uppercase token in text)
//  - Common aliases / demonyms (built-in static map)
// Picks the highest-scored ISO3 and writes it to affected_countries.
// Stores all candidates + confidence + method.
//
// Idempotent. Does not overwrite an existing affected_countries unless the new
// confidence is higher AND the previous extraction method was weak/null.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH = 250;

// Static demonym/alias map for the most common cases. Keys are lowercase
// alias tokens; value is ISO3. Multilingual where it's cheap and unambiguous.
const ALIASES: Record<string, string> = {
  // EN demonyms / aliases
  "american": "USA", "americans": "USA", "u.s.": "USA", "us": "USA",
  "u.s.a": "USA", "united states": "USA", "washington": "USA",
  "british": "GBR", "uk": "GBR", "u.k.": "GBR", "england": "GBR",
  "scotland": "GBR", "wales": "GBR", "london": "GBR",
  "french": "FRA", "france": "FRA", "paris": "FRA",
  "german": "DEU", "germany": "DEU", "berlin": "DEU",
  "spanish": "ESP", "madrid": "ESP",
  "italian": "ITA", "italy": "ITA", "rome": "ITA",
  "russian": "RUS", "russia": "RUS", "moscow": "RUS", "kremlin": "RUS",
  "chinese": "CHN", "china": "CHN", "beijing": "CHN",
  "japanese": "JPN", "japan": "JPN", "tokyo": "JPN",
  "korean": "KOR", "south korea": "KOR", "seoul": "KOR",
  "north korea": "PRK", "pyongyang": "PRK", "dprk": "PRK",
  "indian": "IND", "india": "IND", "delhi": "IND", "new delhi": "IND",
  "pakistani": "PAK", "pakistan": "PAK", "islamabad": "PAK",
  "bangladeshi": "BGD", "bangladesh": "BGD", "dhaka": "BGD",
  "indonesian": "IDN", "indonesia": "IDN", "jakarta": "IDN",
  "turkish": "TUR", "turkey": "TUR", "ankara": "TUR", "istanbul": "TUR", "türkiye": "TUR",
  "iranian": "IRN", "iran": "IRN", "tehran": "IRN",
  "iraqi": "IRQ", "iraq": "IRQ", "baghdad": "IRQ",
  "syrian": "SYR", "syria": "SYR", "damascus": "SYR",
  "israeli": "ISR", "israel": "ISR", "jerusalem": "ISR",
  "palestinian": "PSE", "palestine": "PSE", "gaza": "PSE", "west bank": "PSE",
  "saudi": "SAU", "saudi arabia": "SAU", "riyadh": "SAU",
  "emirati": "ARE", "uae": "ARE", "dubai": "ARE", "abu dhabi": "ARE",
  "egyptian": "EGY", "egypt": "EGY", "cairo": "EGY",
  "ukrainian": "UKR", "ukraine": "UKR", "kyiv": "UKR", "kiev": "UKR",
  "polish": "POL", "poland": "POL", "warsaw": "POL",
  "dutch": "NLD", "netherlands": "NLD", "amsterdam": "NLD", "the hague": "NLD",
  "belgian": "BEL", "belgium": "BEL", "brussels": "BEL",
  "swiss": "CHE", "switzerland": "CHE", "geneva": "CHE", "zurich": "CHE", "bern": "CHE",
  "swedish": "SWE", "sweden": "SWE", "stockholm": "SWE",
  "norwegian": "NOR", "norway": "NOR", "oslo": "NOR",
  "danish": "DNK", "denmark": "DNK", "copenhagen": "DNK",
  "finnish": "FIN", "finland": "FIN", "helsinki": "FIN",
  "greek": "GRC", "greece": "GRC", "athens": "GRC",
  "portuguese": "PRT", "portugal": "PRT", "lisbon": "PRT",
  "brazilian": "BRA", "brazil": "BRA", "brasília": "BRA", "brasilia": "BRA", "são paulo": "BRA", "sao paulo": "BRA",
  "argentine": "ARG", "argentinian": "ARG", "argentina": "ARG", "buenos aires": "ARG",
  "mexican": "MEX", "mexico": "MEX", "mexico city": "MEX",
  "colombian": "COL", "colombia": "COL", "bogota": "COL", "bogotá": "COL",
  "venezuelan": "VEN", "venezuela": "VEN", "caracas": "VEN",
  "chilean": "CHL", "chile": "CHL", "santiago": "CHL",
  "peruvian": "PER", "peru": "PER", "lima": "PER",
  "canadian": "CAN", "canada": "CAN", "ottawa": "CAN", "toronto": "CAN",
  "australian": "AUS", "australia": "AUS", "canberra": "AUS", "sydney": "AUS",
  "kiwi": "NZL", "new zealand": "NZL", "wellington": "NZL", "auckland": "NZL",
  "south african": "ZAF", "south africa": "ZAF", "johannesburg": "ZAF", "pretoria": "ZAF", "cape town": "ZAF",
  "nigerian": "NGA", "nigeria": "NGA", "abuja": "NGA", "lagos": "NGA",
  "kenyan": "KEN", "kenya": "KEN", "nairobi": "KEN",
  "ethiopian": "ETH", "ethiopia": "ETH", "addis ababa": "ETH",
  "ghanaian": "GHA", "ghana": "GHA", "accra": "GHA",
  "moroccan": "MAR", "morocco": "MAR", "rabat": "MAR",
  "algerian": "DZA", "algeria": "DZA", "algiers": "DZA",
  "tunisian": "TUN", "tunisia": "TUN", "tunis": "TUN",
  "libyan": "LBY", "libya": "LBY", "tripoli": "LBY",
  "sudanese": "SDN", "sudan": "SDN", "khartoum": "SDN",
  "afghan": "AFG", "afghanistan": "AFG", "kabul": "AFG",
  "yemeni": "YEM", "yemen": "YEM", "sanaa": "YEM",
  "lebanese": "LBN", "lebanon": "LBN", "beirut": "LBN",
  "jordanian": "JOR", "jordan": "JOR", "amman": "JOR",
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
  // Multilingual quick wins
  "états-unis": "USA", "estados unidos": "USA", "alemania": "DEU", "allemagne": "DEU",
  "rusia": "RUS", "russie": "RUS", "chine": "CHN", "японии": "JPN",
};

type CountryRow = { iso3: string; canonical_name: string };
type Candidate = { iso3: string; score: number; matched: string[] };

// Pre-built lookup tables (built once per request, reused per signal).
type Lookups = {
  // lowercase token → [{iso3, weight, label}]
  nameMap: Map<string, { iso3: string; weight: number; label: string }>;
  aliasMap: Map<string, { iso3: string; weight: number; label: string }>;
  iso3Set: Set<string>;
};

function buildLookups(countries: CountryRow[]): Lookups {
  const nameMap = new Map<string, { iso3: string; weight: number; label: string }>();
  const aliasMap = new Map<string, { iso3: string; weight: number; label: string }>();
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
  return { nameMap, aliasMap, iso3Set };
}

// Tokenize text once into a set of word tokens (lowercase) and a set of
// uppercase 3-letter tokens (for bare-ISO3 matching). Avoids per-country regex.
function tokenizeOnce(text: string): { lowerTokens: Set<string>; lowerBigrams: Set<string>; lowerTrigrams: Set<string>; upperTriTokens: Set<string> } {
  const lower = text.toLowerCase();
  const wordsLower = lower.match(/[\p{L}][\p{L}'.-]{0,40}/gu) || [];
  const wordsUpper = text.match(/[A-Z]{3}/g) || [];
  const lowerTokens = new Set(wordsLower);
  // bigrams + trigrams (joined by single space) for multi-word names like "south africa"
  const lowerBigrams = new Set<string>();
  const lowerTrigrams = new Set<string>();
  for (let i = 0; i < wordsLower.length - 1; i++) {
    lowerBigrams.add(`${wordsLower[i]} ${wordsLower[i + 1]}`);
    if (i < wordsLower.length - 2) {
      lowerTrigrams.add(`${wordsLower[i]} ${wordsLower[i + 1]} ${wordsLower[i + 2]}`);
    }
  }
  const upperTriTokens = new Set(wordsUpper);
  return { lowerTokens, lowerBigrams, lowerTrigrams, upperTriTokens };
}

function extractCandidates(text: string, lookups: Lookups): Candidate[] {
  if (!text) return [];
  const { nameMap, aliasMap, iso3Set } = lookups;
  const { lowerTokens, lowerBigrams, lowerTrigrams, upperTriTokens } = tokenizeOnce(text);
  const scores = new Map<string, Candidate>();
  const bump = (iso3: string, weight: number, label: string) => {
    const c = scores.get(iso3);
    if (c) {
      c.score += weight;
      if (!c.matched.includes(label) && c.matched.length < 6) c.matched.push(label);
    } else {
      scores.set(iso3, { iso3, score: weight, matched: [label] });
    }
  };

  // helper to test a candidate phrase against the prebuilt sets
  const testPhrase = (phrase: string): boolean => {
    const wc = phrase.split(" ").length;
    if (wc === 1) return lowerTokens.has(phrase);
    if (wc === 2) return lowerBigrams.has(phrase);
    if (wc === 3) return lowerTrigrams.has(phrase);
    return false;
  };

  // 1) Canonical names (max 3 words via tokenized sets)
  for (const [name, meta] of nameMap) {
    if (testPhrase(name)) bump(meta.iso3, meta.weight, meta.label);
  }
  // 2) Aliases
  for (const [alias, meta] of aliasMap) {
    if (testPhrase(alias)) bump(meta.iso3, meta.weight, meta.label);
  }
  // 3) Bare uppercase ISO3 tokens
  for (const tok of upperTriTokens) {
    if (iso3Set.has(tok)) bump(tok, 25, `iso3:${tok}`);
  }

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let processed = 0, extracted = 0, none = 0;

  try {
    // Load canonical country list once
    const { data: countries, error: cErr } = await supa
      .from("canonical_country_list")
      .select("iso3,canonical_name")
      .eq("entity_type", "country");
    if (cErr) throw cErr;
    const countryRows = (countries || []) as CountryRow[];

    // Pull a batch of signals lacking attribution
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";

    const { data: pending, error } = await supa
      .from("global_signals")
      .select("id,title,summary,translated_title,translated_summary,affected_countries,country_extraction_method,country_extraction_confidence")
      .or("affected_countries.is.null,affected_countries.eq.{}")
      .is("country_extracted_at", null)
      .order("first_detected_at", { ascending: false })
      .limit(BATCH);
    if (error) throw error;

    for (const sig of pending || []) {
      processed++;
      const text = [sig.translated_title, sig.translated_summary, sig.title, sig.summary]
        .filter(Boolean).join("  ");
      const cands = extractCandidates(text, countryRows);

      const update: any = {
        country_extracted_at: new Date().toISOString(),
        extracted_country_candidates: cands.slice(0, 5),
        country_extraction_method: "alias_dictionary_v1",
      };

      if (cands.length === 0) {
        update.country_extraction_status = "no_match";
        update.country_extraction_confidence = 0;
        none++;
      } else {
        const top = cands[0];
        const confidence = Math.min(100, Math.round(top.score));
        const existingAc = (sig.affected_countries || []) as string[];
        // Only overwrite if empty OR our confidence is higher than existing
        const shouldWrite = force ||
          existingAc.length === 0 ||
          (sig.country_extraction_confidence ?? 0) < confidence;
        if (shouldWrite) {
          update.affected_countries = [top.iso3];
          update.country_extraction_status = "extracted";
          update.country_extraction_confidence = confidence;
          extracted++;
        } else {
          update.country_extraction_status = "skipped_existing";
          update.country_extraction_confidence = confidence;
        }
      }

      const { error: uErr } = await supa.from("global_signals").update(update).eq("id", sig.id);
      if (uErr) throw uErr;
    }

    // After extraction, retry geocoder failures by clearing geocoded_at on rows
    // we just attributed, so the next geocoder run picks them up.
    if (extracted > 0) {
      await supa
        .from("global_signals")
        .update({ geocoded_at: null })
        .eq("geo_method", "failed")
        .not("affected_countries", "eq", "{}");
    }

    await supa.from("automation_logs").insert({
      job_name: "signal-country-extractor",
      status: "success",
      message: `processed=${processed} extracted=${extracted} no_match=${none} in ${Date.now() - startedAt}ms`,
    });
    return new Response(JSON.stringify({ processed, extracted, no_match: none }), {
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
