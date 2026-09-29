// Deterministic, query-conditioned evidence selection for Ask AICIS.
// No model calls. Every rule here is plain data so it can be read and tested.
// Unknown stays unknown: thin evidence is reported as thin, never padded.

export const EVIDENCE_QUALITY_VERSION = "evidence-quality-v1";

export const MAX_EXTERNAL_PER_DOMAIN = 8;
export const MAX_INTERNAL_WHEN_THIN = 2;

// Positive terms per specialist domain. Matched on word starts, so "sanction"
// also matches "sanctions" / "sanctioned".
export const DOMAIN_TERMS = {
  security: [
    "conflict", "attack", "armed", "militant", "insurg", "terror", "jihad", "rebel", "militia",
    "violence", "violent", "clash", "killed", "kidnap", "bomb", "explosi", "shooting", "gunmen",
    "troops", "military", "army", "soldier", "defence", "defense", "police", "unrest", "riot",
    "protest", "coup", "border security", "smuggl", "traffick", "drug", "narcotic", "piracy",
    "cyberattack", "ransomware", "hack", "breach", "security", "crime", "criminal",
  ],
  governance: [
    "government", "minister", "ministry", "parliament", "president", "election", "vote", "policy",
    "regulat", "law", "legislat", "court", "judici", "corruption", "cabinet", "governance",
    "constitution", "reform", "sanction", "diplomat", "treaty", "opposition", "decree", "public sector",
  ],
  finance: [
    "econom", "inflation", "currency", "cedi", "exchange rate", "debt", "bond", "imf", "budget",
    "fiscal", "tax", "revenue", "bank", "interest rate", "central bank", "gdp", "growth", "investment",
    "investor", "market", "stock", "credit", "loan", "deficit", "export", "import", "trade", "cost",
    "price", "tariff", "public financ", "subsid",
  ],
  energy: [
    "energy", "power", "electricity", "grid", "gas", "oil", "fuel", "petrol", "diesel", "refiner",
    "megawatt", " mw", "solar", "wind", "hydro", "nuclear", "blackout", "outage", "dumsor", "lng",
    "pipeline", "utility", "coal",
  ],
  food: [
    "food", "crop", "harvest", "farm", "agricultur", "grain", "maize", "rice", "wheat", "cocoa",
    "fertili", "livestock", "hunger", "famine", "malnutrition", "food production", "drought",
    "irrigat", "fisher",
  ],
  health: [
    "health", "hospital", "disease", "outbreak", "epidemic", "pandemic", "vaccin", "cholera",
    "malaria", "ebola", "mpox", "virus", "patient", "clinic", "medical", "doctor", "nurse",
    "health record", "ehr", "mortality",
  ],
  climate: [
    "climate", "flood", "drought", "storm", "cyclone", "heatwave", "heat wave", "wildfire",
    "rainfall", "sea level", "erosion", "emission", "carbon", "weather", "landslide",
  ],
  supply_chain: [
    "supply chain", "shipping", "port", "freight", "logistic", "container", "shortage", "export",
    "import", "customs", "manufactur", "semiconductor", "shipment", "cargo", "warehouse", "trade route",
  ],
  migration: [
    "migra", "refugee", "displace", "asylum", "idp", "border crossing", "deport", "diaspora", "exodus",
  ],
};

// Stored categories that normally belong to each domain. A category match only
// adds weight when the text also matches the domain; it never admits alone,
// because upstream categories are sometimes wrong.
export const DOMAIN_CATEGORIES = {
  security: ["defense_conflict", "social_unrest", "cybersecurity", "maritime_security"],
  governance: ["geopolitical", "legal_regulatory", "elections"],
  finance: ["economic", "financial_markets", "central_banking"],
  energy: ["energy", "infrastructure"],
  food: ["food_agriculture", "water_hydrology"],
  health: ["public_health"],
  climate: ["climate_disaster"],
  supply_chain: ["supply_chain", "technology"],
  migration: ["migration_displacement"],
};

const STOPWORDS = new Set([
  "what", "which", "where", "when", "who", "whom", "whose", "why", "how", "can", "could", "should",
  "would", "will", "does", "did", "the", "and", "for", "with", "about", "from", "into", "that", "this",
  "there", "their", "they", "them", "are", "was", "were", "been", "being", "have", "has", "had",
  "aicis", "conclude", "concluded", "tell", "know", "say", "current", "currently", "situation",
  "happening", "latest", "today", "now", "right", "overall", "state", "status", "outlook", "risk",
  "risks", "country", "countries", "region", "regions", "please", "give", "show", "explain",
]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function countTerm(text, term) {
  if (!text) return 0;
  const t = term.trim();
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(t)}`, "g");
  return (text.match(re) || []).length;
}

const lower = (s) => (typeof s === "string" ? s.toLowerCase() : "");

/** Question content words, minus stopwords and resolved place names. */
export function questionTerms(question, excludeNames = []) {
  const excluded = new Set(
    excludeNames.flatMap((n) => lower(n).split(/[^a-z0-9]+/)).filter(Boolean),
  );
  const seen = new Set();
  for (const tok of lower(question).split(/[^a-z0-9]+/)) {
    if (tok.length < 4 || STOPWORDS.has(tok) || excluded.has(tok)) continue;
    seen.add(tok);
  }
  return [...seen];
}

/** Title matches count double; summary matches count once (capped per term). */
export function domainTextScore(domain, title, summary) {
  const terms = DOMAIN_TERMS[domain] ?? [];
  const t = lower(title);
  const s = lower(summary);
  let score = 0;
  const hits = [];
  for (const term of terms) {
    const inTitle = countTerm(t, term) > 0;
    const inSummary = countTerm(s, term) > 0;
    if (inTitle || inSummary) {
      hits.push(term.trim());
      score += (inTitle ? 2 : 0) + (inSummary ? 1 : 0);
    }
  }
  return { score, hits };
}

/**
 * Deterministic relevance of one global_signals row to one specialist domain.
 * Admission: strong domain match (>=2), OR strong question match (>=2) with at
 * least some domain support and no other domain clearly dominating.
 */
export function scoreSignalForDomain({ domain, signal, qTerms = [], iso3List = [] }) {
  const title = signal?.title ?? "";
  const summary = signal?.summary ?? "";
  const own = domainTextScore(domain, title, summary);

  let bestOther = { domain: null, score: 0 };
  for (const d of Object.keys(DOMAIN_TERMS)) {
    if (d === domain) continue;
    const sc = domainTextScore(d, title, summary).score;
    if (sc > bestOther.score) bestOther = { domain: d, score: sc };
  }

  const t = lower(title);
  const s = lower(summary);
  let qScore = 0;
  for (const q of qTerms) qScore += (countTerm(t, q) > 0 ? 2 : 0) + (countTerm(s, q) > 0 ? 1 : 0);

  const categoryMatch = (DOMAIN_CATEGORIES[domain] ?? []).includes(signal?.category);
  const geoMatch = iso3List.length === 0 || iso3List.includes(signal?.geo_admin0_iso3);

  const conflicts = own.score === 0 || bestOther.score >= own.score * 2 + 2;
  const strongDomain = own.score >= 2 && !(bestOther.score >= own.score * 3);
  const strongQuestion = qScore >= 2 && own.score >= 1 && !conflicts;

  let admitted = geoMatch && (strongDomain || strongQuestion);
  let reason = admitted ? (strongDomain ? "domain_terms" : "question_terms") : "off_topic";
  if (!geoMatch) reason = "geography_mismatch";

  const score = own.score * 2 + qScore + (categoryMatch && own.score > 0 ? 2 : 0) + (geoMatch ? 1 : 0);
  return {
    admitted,
    reason,
    score,
    domain_score: own.score,
    domain_hits: own.hits,
    question_score: qScore,
    category_match: categoryMatch,
    geo_match: geoMatch,
    competing_domain: bestOther.domain,
    competing_score: bestOther.score,
  };
}

function normalizeUrl(u) {
  if (typeof u !== "string" || !/^https?:\/\//i.test(u)) return null;
  try {
    const x = new URL(u.trim());
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Title identity: lowercased, parentheticals and punctuation removed. */
export function normalizeTitle(title) {
  return lower(title)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Keys an item can be deduplicated on (any shared key = duplicate). */
export function dedupeKeys({ id, url, title }) {
  const keys = [];
  if (id) keys.push(`id:${id}`);
  const nu = normalizeUrl(url);
  if (nu) keys.push(`url:${nu}`);
  const nt = normalizeTitle(title);
  if (nt.length >= 12) keys.push(`title:${nt}`);
  return keys;
}

/**
 * Collapse internal snapshots whose values are unchanged across dates, newest
 * first, then cap. With external evidence present, internal rows may not
 * exceed the external count (>=50% external target).
 */
export function selectInternalSnapshots(snapshots, externalCount) {
  const sorted = [...(snapshots ?? [])].sort((a, b) =>
    String(b.snapshot_date).localeCompare(String(a.snapshot_date)),
  );
  const distinct = [];
  let collapsed = 0;
  for (const s of sorted) {
    const prev = distinct[distinct.length - 1];
    const same = prev && prev.iso3 === s.iso3 &&
      Number(prev.performance_index) === Number(s.performance_index) &&
      Number(prev.momentum_score ?? 0) === Number(s.momentum_score ?? 0) &&
      Number(prev.volatility_index ?? 0) === Number(s.volatility_index ?? 0);
    if (same) {
      collapsed++;
      prev._unchanged_since = s.snapshot_date;
      continue;
    }
    distinct.push({ ...s });
  }
  const cap = externalCount > 0 ? Math.max(1, Math.min(externalCount, MAX_INTERNAL_WHEN_THIN + 2)) : MAX_INTERNAL_WHEN_THIN;
  const kept = distinct.slice(0, cap);
  return { kept, collapsed_unchanged: collapsed, capped: distinct.length - kept.length };
}

export function evidenceSufficiency(externalCount) {
  if (externalCount >= 4) return "strong";
  if (externalCount >= 2) return "moderate";
  return "thin";
}

/**
 * Build one specialist's evidence selection from a shared candidate pool.
 * Pure: returns chosen signals, chosen snapshots and transparent counts.
 */
export function selectDomainEvidence({ domain, signals, snapshots, qTerms, iso3List, citationSource }) {
  let rejected = 0;
  const scored = [];
  for (const s of signals ?? []) {
    const r = scoreSignalForDomain({ domain, signal: s, qTerms, iso3List });
    if (!r.admitted) {
      // Only count rows the stored category claimed for this domain, or that
      // had some textual pull, so the metric reflects real near-misses.
      if ((DOMAIN_CATEGORIES[domain] ?? []).includes(s.category) || r.domain_score > 0) rejected++;
      continue;
    }
    scored.push({ signal: s, relevance: r });
  }
  scored.sort((a, b) =>
    b.relevance.score - a.relevance.score ||
    String(b.signal.occurred_at ?? b.signal.ingested_at ?? "").localeCompare(String(a.signal.occurred_at ?? a.signal.ingested_at ?? "")),
  );

  const seen = new Set();
  let deduplicated = 0;
  const external = [];
  for (const item of scored) {
    const cite = citationSource ? citationSource(item.signal) : { url: null, publisher: null };
    const keys = dedupeKeys({ id: item.signal.canonical_event_id ?? item.signal.dedup_key ?? null, url: cite.url, title: item.signal.title });
    if (keys.some((k) => seen.has(k))) {
      deduplicated++;
      continue;
    }
    keys.forEach((k) => seen.add(k));
    if (external.length < MAX_EXTERNAL_PER_DOMAIN) external.push({ ...item, cite });
  }

  const internal = selectInternalSnapshots(snapshots, external.length);
  deduplicated += internal.collapsed_unchanged;

  return {
    external,
    internal: internal.kept,
    meta: {
      external_evidence_count: external.length,
      internal_measurement_count: internal.kept.length,
      rejected_irrelevant_count: rejected,
      deduplicated_count: deduplicated,
      internal_capped_count: internal.capped,
      evidence_sufficiency: evidenceSufficiency(external.length),
    },
  };
}

export function aggregateEvidenceQuality(byDomain) {
  const vals = Object.values(byDomain);
  const sum = (k) => vals.reduce((a, m) => a + (m[k] ?? 0), 0);
  const external = sum("external_evidence_count");
  const internal = sum("internal_measurement_count");
  const total = external + internal;
  const order = { thin: 0, moderate: 1, strong: 2 };
  const weakest = vals.reduce((w, m) => (order[m.evidence_sufficiency] < order[w] ? m.evidence_sufficiency : w), "strong");
  return {
    version: EVIDENCE_QUALITY_VERSION,
    external_evidence_count: external,
    internal_measurement_count: internal,
    rejected_irrelevant_count: sum("rejected_irrelevant_count"),
    deduplicated_count: sum("deduplicated_count"),
    internal_share: total ? Math.round((internal / total) * 100) / 100 : null,
    mostly_internal: total > 0 && internal > external,
    weakest_domain_sufficiency: vals.length ? weakest : "thin",
    overall_sufficiency: evidenceSufficiency(vals.length ? Math.min(...vals.map((m) => m.external_evidence_count)) : 0),
  };
}
