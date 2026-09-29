// AICIS Ask scope resolver v1 — deterministic geography + domain routing.
// Pure module: no I/O. Used by orchestrate-multi-agent and node tests.
//
// Truth-floor rules:
// - Full country names (from live country_profiles) match first, longest first,
//   on word boundaries, so "Niger" never matches inside "Nigeria".
// - ISO3 codes are accepted only as standalone UPPERCASE tokens in a question
//   that is not itself written in all caps, and never when the token is an
//   ordinary English word (AND, ARE, CAN, ...).
// - Unresolvable geography returns clarification_needed. It never silently
//   widens to global data.

export const ASK_SCOPE_VERSION = "ask-scope-v1";

export const ORCHESTRATOR_DOMAINS = [
  "security", "governance", "finance", "energy", "food",
  "health", "climate", "supply_chain", "migration",
];

export const REGION_ISO3 = {
  "east africa": ["BDI", "COM", "DJI", "ERI", "ETH", "KEN", "MDG", "MWI", "MUS", "MOZ", "RWA", "SYC", "SOM", "SSD", "TZA", "UGA", "ZMB", "ZWE"],
  "west africa": ["BEN", "BFA", "CPV", "CIV", "GMB", "GHA", "GIN", "GNB", "LBR", "MLI", "MRT", "NER", "NGA", "SEN", "SLE", "TGO"],
  "european union": ["AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE"],
  sahel: ["SEN", "MRT", "MLI", "BFA", "NER", "TCD", "SDN", "NGA", "CMR", "GMB"],
  "east asia": ["CHN", "JPN", "KOR", "PRK", "MNG", "TWN", "HKG", "MAC"],
};

const REGION_ALIASES = [
  { pattern: /\beast(?:ern)?\s+africa\b/i, key: "east africa", label: "East Africa" },
  { pattern: /\bwest(?:ern)?\s+africa\b/i, key: "west africa", label: "West Africa" },
  { pattern: /\beuropean\s+union\b/i, key: "european union", label: "European Union" },
  { pattern: /\bEU\b/, key: "european union", label: "European Union" },
  { pattern: /\bsahel\b/i, key: "sahel", label: "Sahel" },
  { pattern: /\beast\s+asia\b/i, key: "east asia", label: "East Asia" },
];

const GLOBAL_PATTERN = /\b(global(?:ly)?|worldwide|world|planet(?:ary)?|all countries)\b/i;

// Known cities with no safe, app-verified city→country mapping. We do not guess.
const KNOWN_CITIES = /\b(berlin|paris|london|lagos|nairobi|accra|tokyo|beijing|new york|washington|moscow|delhi|cairo|kinshasa|addis ababa)\b/i;

// ISO3 codes that are also ordinary English words; never accepted as ISO3.
const ENGLISH_WORD_ISO3 = new Set(["AND", "ARE", "CAN", "PER", "TON", "BEL", "MAR", "COG", "GAB", "NOR", "SOM", "TUN", "CUB", "IRL", "POL", "ITA", "LIE", "MLI"]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {string} question
 * @param {{iso3: string, country_name: string}[]} countries live country_profiles rows
 * @param {{iso3?: string|null}} [context] optional selected context
 */
export function resolveGeography(question, countries, context = {}) {
  const text = String(question ?? "");
  const iso3Set = new Set();
  const matched = [];
  const regions = [];
  const byIso = new Map();
  for (const c of countries ?? []) {
    if (c?.iso3 && c?.country_name) byIso.set(String(c.iso3).toUpperCase(), String(c.country_name));
  }

  // 1) Regions (expand to explicit ISO3 lists).
  let masked = text;
  for (const r of REGION_ALIASES) {
    if (r.pattern.test(masked)) {
      if (!regions.some((x) => x.key === r.key)) {
        regions.push({ key: r.key, label: r.label, iso3: [...REGION_ISO3[r.key]] });
        REGION_ISO3[r.key].forEach((i) => iso3Set.add(i));
      }
      masked = masked.replace(new RegExp(r.pattern.source, r.pattern.flags.includes("g") ? r.pattern.flags : r.pattern.flags + "g"), " ");
    }
  }

  // 2) Full country names, longest first, word-bounded, case-insensitive.
  const names = [...byIso.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [iso, name] of names) {
    const re = new RegExp(`(^|[^\\p{L}])${escapeRe(name)}(?=$|[^\\p{L}])`, "iu");
    if (re.test(masked)) {
      iso3Set.add(iso);
      matched.push({ iso3: iso, name, via: "country_name" });
      masked = masked.replace(new RegExp(`(^|[^\\p{L}])${escapeRe(name)}(?=$|[^\\p{L}])`, "giu"), "$1 ");
    }
  }

  // 3) Explicit standalone uppercase ISO3 tokens only.
  const letters = text.replace(/[^A-Za-z]/g, "");
  const shouting = letters.length > 0 && letters === letters.toUpperCase();
  if (!shouting) {
    for (const m of masked.matchAll(/(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/g)) {
      const tok = m[1];
      if (ENGLISH_WORD_ISO3.has(tok) || !byIso.has(tok) || iso3Set.has(tok)) continue;
      iso3Set.add(tok);
      matched.push({ iso3: tok, name: byIso.get(tok), via: "iso3_token" });
    }
  }

  if (iso3Set.size > 0) {
    return {
      version: ASK_SCOPE_VERSION,
      status: "resolved",
      scope: regions.length && matched.length === 0 && regions.length === 1 ? "region" : iso3Set.size === 1 ? "country" : "multi_country",
      iso3: [...iso3Set].sort(),
      countries: matched,
      regions,
      source: "question",
    };
  }

  if (GLOBAL_PATTERN.test(text)) {
    return { version: ASK_SCOPE_VERSION, status: "resolved", scope: "global", iso3: [], countries: [], regions: [], source: "question" };
  }

  const ctxIso = typeof context?.iso3 === "string" ? context.iso3.toUpperCase() : null;
  if (ctxIso && byIso.has(ctxIso)) {
    return {
      version: ASK_SCOPE_VERSION,
      status: "resolved",
      scope: "country",
      iso3: [ctxIso],
      countries: [{ iso3: ctxIso, name: byIso.get(ctxIso), via: "selected_context" }],
      regions: [],
      source: "selected_context",
    };
  }

  const city = text.match(KNOWN_CITIES)?.[0] ?? null;
  return {
    version: ASK_SCOPE_VERSION,
    status: "clarification_needed",
    scope: null,
    iso3: [],
    countries: [],
    regions: [],
    source: null,
    reason: city ? "city_without_verified_mapping" : "no_geography_detected",
    unresolved_term: city,
    clarification: city
      ? `AICIS has no verified city-to-country mapping for "${city}". Name the country (for example "Germany") or say "global".`
      : `Which geography should AICIS analyse? Name a country, a region (East Africa, West Africa, Sahel, East Asia, EU), or say "global".`,
  };
}

const DOMAIN_KEYWORDS = {
  security: ["security", "conflict", "war", "attack", "violence", "terror", "military", "coup", "insurgen", "unrest", "protest", "cyber", "piracy", "armed"],
  governance: ["governance", "government", "election", "political", "politics", "policy", "regulat", "law", "sanction", "corruption", "stability", "democra", "parliament"],
  finance: ["finance", "financial", "economy", "economic", "inflation", "currency", "debt", "bank", "market", "gdp", "interest rate", "invest", "fiscal", "recession", "exchange rate"],
  energy: ["energy", "oil", "gas", "electric", "power", "grid", "fuel", "renewable", "solar", "coal", "blackout"],
  food: ["food", "hunger", "famine", "crop", "harvest", "agricultur", "grain", "wheat", "maize", "cocoa", "water"],
  health: ["health", "disease", "outbreak", "epidemic", "pandemic", "cholera", "malaria", "hospital", "vaccine", "mpox", "ebola"],
  climate: ["climate", "flood", "drought", "heat", "storm", "cyclone", "hurricane", "wildfire", "rainfall", "disaster", "weather"],
  supply_chain: ["supply chain", "supply", "shipping", "port", "logistic", "trade", "export", "import", "semiconductor", "freight", "shortage"],
  migration: ["migration", "migrant", "refugee", "displace", "asylum", "border crossing"],
};

const COMPANION = {
  security: "governance", governance: "security", finance: "governance", energy: "finance",
  food: "climate", health: "governance", climate: "food", supply_chain: "finance", migration: "security",
};

export const DEFAULT_DOMAINS = ["security", "governance", "finance"];
export const MAX_DOMAINS = 4;

/** Deterministic keyword routing; always returns 2..MAX_DOMAINS supported domains. */
export function routeDomains(question) {
  const q = String(question ?? "").toLowerCase();
  const scored = [];
  for (const d of ORCHESTRATOR_DOMAINS) {
    const hits = DOMAIN_KEYWORDS[d].filter((k) => new RegExp(`\\b${escapeRe(k)}`).test(q));
    if (hits.length) scored.push({ domain: d, hits });
  }
  scored.sort((a, b) => b.hits.length - a.hits.length || ORCHESTRATOR_DOMAINS.indexOf(a.domain) - ORCHESTRATOR_DOMAINS.indexOf(b.domain));
  let domains = scored.slice(0, MAX_DOMAINS).map((s) => s.domain);
  let routing = "keyword";
  if (domains.length === 0) {
    domains = [...DEFAULT_DOMAINS];
    routing = "default_cross_domain";
  } else if (domains.length === 1) {
    domains.push(COMPANION[domains[0]]);
    routing = "keyword_plus_companion";
  }
  return { domains, routing, matched_keywords: Object.fromEntries(scored.map((s) => [s.domain, s.hits])) };
}

const isHttpUrl = (v) => {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

/**
 * Chooses the real document URL for a global_signals row. Prefers
 * source_references[].url; accepts primary_source only when it is itself a URL.
 * Never fabricates a URL.
 */
export function signalCitationSource(signal) {
  const refs = Array.isArray(signal?.source_references) ? signal.source_references : [];
  const ref = refs.find((r) => r && isHttpUrl(r.url));
  const primary = typeof signal?.primary_source === "string" ? signal.primary_source.trim() : null;
  const url = ref ? ref.url.trim() : isHttpUrl(primary) ? primary : null;
  const publisher = (ref && typeof ref.name === "string" && ref.name.trim())
    || (primary && !isHttpUrl(primary) ? primary : null)
    || (refs.find((r) => r && typeof r.name === "string")?.name ?? null);
  return { url, publisher };
}
