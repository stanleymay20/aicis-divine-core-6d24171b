export const COUNTERPARTY_DISCOVERY_VERSION = "aicis-counterparty-discovery-v1";

const GENERIC_MAILBOXES = new Set([
  "info",
  "contact",
  "sales",
  "export",
  "exports",
  "trade",
  "trading",
  "procurement",
  "purchasing",
  "buying",
  "commercial",
  "business",
  "office",
  "support",
  "hello",
  "enquiries",
  "inquiries",
]);

const LOW_SIGNAL_HOSTS = new Set([
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "wikipedia.org",
]);

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function terms(value) {
  return clean(value).toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2);
}

function roleTerms(role) {
  if (role === "supplier") return ["supplier", "producer", "manufacturer", "exporter", "wholesale"];
  if (role === "buyer") return ["buyer", "importer", "procurement", "purchasing", "distributor", "processor"];
  if (role === "logistics") return ["freight", "logistics", "shipping", "forwarder", "transport"];
  return [role].filter(Boolean);
}

export function buildCounterpartyQueries(input = {}) {
  const product = clean(input.product_name);
  const role = clean(input.role).toLowerCase();
  const countries = Array.isArray(input.countries) ? input.countries.map(clean).filter(Boolean) : [];
  const origin = clean(input.origin_country);
  const destination = clean(input.destination_country);
  const queries = [];

  if (!product || !["supplier", "buyer", "logistics"].includes(role)) return [];

  if (role === "logistics") {
    if (origin && destination) {
      queries.push(`"${product}" freight forwarder ${origin} ${destination} official website`);
      queries.push(`"${product}" shipping logistics ${origin} ${destination} contact`);
    } else {
      for (const country of countries.slice(0, 4)) {
        queries.push(`"${product}" logistics freight ${country} official website`);
      }
    }
  } else {
    const words = role === "supplier"
      ? "supplier producer exporter"
      : "buyer importer procurement distributor";
    for (const country of countries.slice(0, 6)) {
      queries.push(`"${product}" ${words} ${country} official website`);
      queries.push(`"${product}" ${words} ${country} contact`);
    }
  }

  return [...new Set(queries)].slice(0, 12);
}

function discoveryFit(hit, input) {
  const productTerms = terms(input.product_name);
  const roles = roleTerms(input.role);
  const countries = Array.isArray(input.countries) ? input.countries.map((v) => clean(v).toLowerCase()) : [];
  const haystack = [hit.title, hit.description, hit.url].map((v) => clean(v).toLowerCase()).join(" ");
  const host = hostOf(hit.url);
  let score = 0;

  if (productTerms.some((term) => haystack.includes(term))) score += 35;
  if (roles.some((term) => haystack.includes(term))) score += 30;
  if (countries.some((country) => country && haystack.includes(country))) score += 20;
  if (host && !LOW_SIGNAL_HOSTS.has(host)) score += 10;
  if (hit.title && hit.description) score += 5;

  return Math.min(100, score);
}

export function normalizeDiscoveryHits(hits = [], input = {}) {
  const byHost = new Map();

  for (const raw of Array.isArray(hits) ? hits : []) {
    const url = clean(raw?.url || raw?.link);
    const host = hostOf(url);
    if (!url || !host || LOW_SIGNAL_HOSTS.has(host)) continue;

    const candidate = {
      discovery_id: [clean(input.role), host].join(":"),
      role: clean(input.role).toLowerCase(),
      country_context: Array.isArray(input.countries) ? input.countries : [],
      title: clean(raw?.title || raw?.name).slice(0, 300),
      description: clean(raw?.description || raw?.snippet || raw?.markdown).slice(0, 1200),
      discovery_url: url,
      domain: host,
      discovery_fit_score: discoveryFit({ ...raw, url }, input),
      verification_status: "discovery_only_unverified",
      transaction_eligible: false,
      quote_status: "not_obtained",
      compliance_status: "unknown",
      official_site_status: "not_verified",
      contact_channels: [],
      evidence_refs: [],
    };

    const existing = byHost.get(host);
    if (!existing || candidate.discovery_fit_score > existing.discovery_fit_score) {
      byHost.set(host, candidate);
    }
  }

  return [...byHost.values()].sort((a, b) => b.discovery_fit_score - a.discovery_fit_score);
}

export function extractGenericBusinessEmails(text, expectedDomain = "") {
  const value = String(text ?? "");
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const domain = expectedDomain.toLowerCase().replace(/^www\./, "");
  const unique = new Set();

  for (const email of matches) {
    const normalized = email.toLowerCase();
    const [local, emailDomain] = normalized.split("@");
    const rootLocal = local.split(/[+._-]/)[0];
    if (!GENERIC_MAILBOXES.has(rootLocal)) continue;
    if (domain && emailDomain !== domain && !emailDomain.endsWith("." + domain)) continue;
    unique.add(normalized);
  }

  return [...unique].sort();
}

export function attachPublicBusinessContacts(candidate, pageText) {
  const emails = extractGenericBusinessEmails(pageText, candidate?.domain || "");
  return {
    ...candidate,
    contact_channels: emails.map((email) => ({
      type: "generic_business_email",
      value: email,
      source_url: candidate.discovery_url,
      public_business_channel: true,
    })),
  };
}
