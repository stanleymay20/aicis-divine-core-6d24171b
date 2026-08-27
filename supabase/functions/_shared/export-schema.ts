// Shared export-layer helpers: decision-grade schema, compression,
// validation, SDK envelope, HMAC signing.
//
// Truth-floor rule: exports preserve unknown values as null. Missing evidence is
// never converted to zero, one, the Unix epoch, or a fabricated confidence.

export const EXPORT_SCHEMA_VERSION_DEFAULT = "v2";

export interface DecisionGradeSignal {
  signal_id: string;
  title: string;
  summary: string | null;
  domain: string | null;
  country: string | null;
  region: string | null;
  severity: string | null;
  confidence_score: number | null;
  relevance_score: number | null;
  urgency_score: number | null;
  impact_score: number | null;
  score_semantics: {
    confidence: string | null;
    relevance: string | null;
    urgency: string | null;
    impact: string | null;
  };
  trend_direction: string | null;
  affected_sectors: string[];
  affected_entities: string[];
  why_it_matters: string | null;
  recommended_actions: string[];
  source_urls: string[];
  provenance: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
  export_generated_at: string;
}

export interface ExportProfile {
  id: string;
  name: string;
  destination_type: string;
  domains: string[];
  countries: string[];
  regions: string[];
  severity_tiers: string[];
  min_relevance_score: number;
  min_confidence_score: number;
  min_urgency_score: number;
  max_records_per_run: number;
  include_raw_source: boolean;
  include_recommendations: boolean;
  include_explanations: boolean;
  prefer_clusters: boolean;
  schema_version: string;
}

function semanticsUsable(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  const normalized = value.toLowerCase();
  return ![
    "legacy",
    "unknown",
    "unverified",
    "unspecified",
    "unlabeled",
    "withheld",
  ].some((token) => normalized.includes(token));
}

export function clamp01_100(n: unknown): number | null {
  if (n === null || n === undefined || n === "") return null;
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return null;
  if (x <= 1 && x >= 0) return Math.round(x * 100);
  return Math.max(0, Math.min(100, Math.round(x)));
}

function governedScore(value: unknown, semantics: unknown): number | null {
  if (!semanticsUsable(semantics)) return null;
  return clamp01_100(value);
}

export function toIso(d: unknown): string | null {
  if (d === null || d === undefined || d === "") return null;
  const date = new Date(d as string | number | Date);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sourceUrls(row: any): string[] {
  const values = new Set<string>();

  if (Array.isArray(row.source_urls)) {
    for (const value of row.source_urls) {
      if (typeof value === "string" && /^https?:\/\//i.test(value)) values.add(value);
    }
  }

  if (Array.isArray(row.source_references)) {
    for (const reference of row.source_references) {
      const url = reference && typeof reference === "object" ? reference.url : null;
      if (typeof url === "string" && /^https?:\/\//i.test(url)) values.add(url);
    }
  }

  return [...values];
}

// Map raw global_signals row to decision-grade signal. Scores are exported only
// when their semantics are explicit and usable. The compatibility field name
// `confidence_score` does not imply probability semantics.
export function normalizeSignal(
  row: any,
  profile: ExportProfile,
  recsByCountryDomain: Map<string, string[]>,
): DecisionGradeSignal {
  const country = Array.isArray(row.affected_countries) && row.affected_countries.length
    ? String(row.affected_countries[0]).toUpperCase()
    : null;
  const domain = row.category ?? null;
  const recs = profile.include_recommendations
    ? (recsByCountryDomain.get(`${country ?? ""}::${domain ?? ""}`) ?? [])
    : [];

  const confidence = governedScore(row.confidence_score, row.confidence_score_semantics);
  const impact = governedScore(row.impact_score, row.impact_score_semantics);
  const urgency = governedScore(row.urgency_score, row.urgency_score_semantics);
  const relevance = governedScore(row.source_rank_score, row.source_rank_score_semantics);

  return {
    signal_id: String(row.id),
    title: typeof row.title === "string" ? row.title : "",
    summary: typeof row.summary === "string" ? row.summary : null,
    domain,
    country,
    region: Array.isArray(row.affected_regions) && row.affected_regions.length
      ? String(row.affected_regions[0])
      : null,
    severity: severityTier(impact),
    confidence_score: confidence,
    relevance_score: relevance,
    urgency_score: urgency,
    impact_score: impact,
    score_semantics: {
      confidence: typeof row.confidence_score_semantics === "string" ? row.confidence_score_semantics : null,
      relevance: typeof row.source_rank_score_semantics === "string" ? row.source_rank_score_semantics : null,
      urgency: typeof row.urgency_score_semantics === "string" ? row.urgency_score_semantics : null,
      impact: typeof row.impact_score_semantics === "string" ? row.impact_score_semantics : null,
    },
    trend_direction: row.trend_direction ?? null,
    affected_sectors: Array.isArray(row.affected_sectors) ? row.affected_sectors : [],
    affected_entities: Array.isArray(row.affected_entities) ? row.affected_entities : [],
    why_it_matters: profile.include_explanations
      ? (row.why_it_matters ?? row.summary ?? null)
      : null,
    recommended_actions: recs,
    source_urls: profile.include_raw_source ? sourceUrls(row) : [],
    provenance: {
      source: row.canonical_source_name ?? row.primary_source ?? null,
      trust_tier: row.source_trust_tier ?? null,
      ingestion: row.ingestion_source ?? null,
      evidence_hash: row.evidence_hash ?? null,
      source_identifier_count: row.source_identifier_count ?? row.source_count ?? null,
      source_identifier_count_semantics: row.source_identifier_count_semantics ?? row.source_count_semantics ?? null,
      grouped_source_identifier_count: row.merged_source_count ?? null,
      grouped_source_identifier_count_semantics: row.merged_source_count_semantics ?? null,
      source_independence_status: row.source_independence_status ?? "not_assessed",
      independent_origin_count: row.independent_origin_count ?? null,
      source_independence_semantics: row.source_independence_semantics ?? null,
      official_source_present: typeof row.official_source_present === "boolean"
        ? row.official_source_present
        : null,
      source_published_at: toIso(row.source_published_at),
      source_published_at_semantics: row.source_published_at_semantics ?? null,
      occurred_at: toIso(row.occurred_at),
      occurred_at_semantics: row.occurred_at_semantics ?? null,
      first_detected_at_semantics: row.first_detected_at_semantics ?? null,
      license: "AICIS-Public-Aggregate-1.0",
    },
    created_at: toIso(row.first_detected_at ?? row.created_at),
    updated_at: toIso(row.latest_update_at ?? row.updated_at),
    export_generated_at: new Date().toISOString(),
  };
}

export function severityTier(impact: number | null): string | null {
  if (impact === null) return null;
  if (impact >= 80) return "critical";
  if (impact >= 60) return "high";
  if (impact >= 40) return "medium";
  if (impact >= 20) return "low";
  return "info";
}

function avgObserved(
  group: DecisionGradeSignal[],
  key: "confidence_score" | "relevance_score" | "urgency_score" | "impact_score",
): number | null {
  const observed = group
    .map((signal) => signal[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (observed.length === 0) return null;
  return Math.round(observed.reduce((sum, value) => sum + value, 0) / observed.length);
}

function rankValue(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

// Compression is a descriptive country/domain/day bucket. It does not assert
// that bucket members are the same event, causally related, or independent.
export function compressSignals(
  signals: DecisionGradeSignal[],
  opts: { prefer_clusters: boolean },
) {
  const byId = new Map<string, DecisionGradeSignal>();
  for (const signal of signals) {
    const previous = byId.get(signal.signal_id);
    if (!previous || rankValue(signal.relevance_score) > rankValue(previous.relevance_score)) {
      byId.set(signal.signal_id, signal);
    }
  }
  const unique = [...byId.values()];

  if (!opts.prefer_clusters) return { signals: unique, clusters: [] as any[] };

  const groups = new Map<string, DecisionGradeSignal[]>();
  const standalone: DecisionGradeSignal[] = [];
  for (const signal of unique) {
    if (!signal.updated_at) {
      standalone.push(signal);
      continue;
    }
    const day = signal.updated_at.slice(0, 10);
    const key = `${signal.country ?? "XX"}::${signal.domain ?? "unknown"}::${day}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(signal);
  }

  const clusters: any[] = [];
  for (const [key, group] of groups) {
    if (group.length === 1) {
      standalone.push(group[0]);
      continue;
    }
    const [country, domain, day] = key.split("::");
    const top = group
      .slice()
      .sort((left, right) => rankValue(right.relevance_score) - rankValue(left.relevance_score))[0];
    const impact = avgObserved(group, "impact_score");
    clusters.push({
      cluster_id: `${country}-${domain}-${day}`,
      cluster_semantics: "country_domain_day_aggregation_bucket_not_event_identity",
      country,
      domain,
      day,
      signal_count: group.length,
      severity: severityTier(impact),
      confidence_score: avgObserved(group, "confidence_score"),
      relevance_score: avgObserved(group, "relevance_score"),
      urgency_score: avgObserved(group, "urgency_score"),
      impact_score: impact,
      aggregate_semantics: "mean_of_observed_governed_member_scores_only_missing_values_excluded",
      lead_signal_id: top.signal_id,
      title: top.title,
      summary: top.summary,
      why_it_matters: top.why_it_matters,
      recommended_actions: Array.from(
        new Set(group.flatMap((signal) => signal.recommended_actions)),
      ).slice(0, 5),
      affected_entities: Array.from(
        new Set(group.flatMap((signal) => signal.affected_entities)),
      ).slice(0, 20),
      member_signal_ids: group.map((signal) => signal.signal_id),
      generated_at: new Date().toISOString(),
    });
  }
  return { signals: standalone, clusters };
}

export interface ExportValidationIssue {
  signal_id?: string;
  field: string;
  reason: string;
}

export function validateExport(signals: DecisionGradeSignal[]): ExportValidationIssue[] {
  const issues: ExportValidationIssue[] = [];
  const seen = new Set<string>();
  for (const signal of signals) {
    if (seen.has(signal.signal_id)) {
      issues.push({ signal_id: signal.signal_id, field: "signal_id", reason: "duplicate" });
    }
    seen.add(signal.signal_id);
    if (!signal.country) issues.push({ signal_id: signal.signal_id, field: "country", reason: "missing" });
    if (!signal.domain) issues.push({ signal_id: signal.signal_id, field: "domain", reason: "missing" });
    if (!signal.severity) issues.push({ signal_id: signal.signal_id, field: "severity", reason: "missing_or_withheld" });

    for (const key of ["relevance_score", "confidence_score", "urgency_score", "impact_score"] as const) {
      const value = signal[key];
      if (value === null) {
        issues.push({ signal_id: signal.signal_id, field: key, reason: "missing_or_withheld" });
      } else if (value < 0 || value > 100) {
        issues.push({ signal_id: signal.signal_id, field: key, reason: "out_of_range" });
      }
    }

    if (signal.source_urls === undefined) {
      issues.push({ signal_id: signal.signal_id, field: "source_urls", reason: "missing" });
    }
    if (!signal.provenance) {
      issues.push({ signal_id: signal.signal_id, field: "provenance", reason: "missing" });
    }
    if (!signal.created_at) {
      issues.push({ signal_id: signal.signal_id, field: "created_at", reason: "missing" });
    } else if (!/^\d{4}-\d{2}-\d{2}T/.test(signal.created_at)) {
      issues.push({ signal_id: signal.signal_id, field: "created_at", reason: "not_iso" });
    }
    if (!signal.updated_at) {
      issues.push({ signal_id: signal.signal_id, field: "updated_at", reason: "missing" });
    } else if (!/^\d{4}-\d{2}-\d{2}T/.test(signal.updated_at)) {
      issues.push({ signal_id: signal.signal_id, field: "updated_at", reason: "not_iso" });
    }
  }
  return issues;
}

export interface EnvelopeOpts {
  schema_version: string;
  export_batch_id: string;
  cursor?: { next: string | null; has_more: boolean };
  meta?: Record<string, unknown>;
}

export function buildEnvelope<T>(data: T[], opts: EnvelopeOpts) {
  return {
    schema_version: opts.schema_version,
    export_batch_id: opts.export_batch_id,
    generated_at: new Date().toISOString(),
    count: data.length,
    cursor: opts.cursor ?? { next: null, has_more: false },
    meta: opts.meta ?? {},
    data,
  };
}

export function encodeCursor(ts: string, id: string): string {
  return btoa(JSON.stringify({ t: ts, i: id }));
}

export function decodeCursor(c: string | null | undefined): { t: string; i: string } | null {
  if (!c) return null;
  try {
    const parsed = JSON.parse(atob(c));
    return typeof parsed?.t === "string" && typeof parsed?.i === "string" ? parsed : null;
  } catch {
    return null;
  }
}

// HMAC-SHA256 webhook signature: t=<unix>,v1=<hex>
export async function signWebhook(secret: string, body: string): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
  const hex = Array.from(new Uint8Array(sig))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${t},v1=${hex}`;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function rowsToCsv(cols: string[], rows: any[]): string {
  const esc = (value: unknown) => {
    if (value === null || value === undefined) return "";
    let exportValue = value;
    if (typeof exportValue === "object") exportValue = JSON.stringify(exportValue);
    const text = String(exportValue);
    return /[\",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = cols.map(esc).join(",");
  const body = rows.map((row) => cols.map((column) => esc(row[column])).join(",")).join("\n");
  return rows.length ? `${head}\n${body}\n` : `${head}\n`;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-aicis-api-key",
  "Access-Control-Expose-Headers": "x-ratelimit-limit, x-ratelimit-remaining, x-schema-version, x-export-batch-id, x-next-cursor",
};

export function applyProfileFilters<T>(q: any, profile: ExportProfile) {
  if (profile.domains.length) q = q.in("category", profile.domains);
  if (profile.countries.length) q = q.overlaps("affected_countries", profile.countries);
  if (profile.regions.length) q = q.overlaps("affected_regions", profile.regions);
  // Compatibility filters are retained at the storage layer. normalizeSignal
  // still withholds any selected score whose semantics are unusable.
  if (profile.min_confidence_score > 0) q = q.gte("confidence_score", profile.min_confidence_score);
  if (profile.min_urgency_score > 0) q = q.gte("urgency_score", profile.min_urgency_score);
  return q;
}