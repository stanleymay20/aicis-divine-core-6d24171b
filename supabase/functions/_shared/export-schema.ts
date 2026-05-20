// Shared export-layer helpers: decision-grade schema, compression,
// validation, SDK envelope, HMAC signing.

export const EXPORT_SCHEMA_VERSION_DEFAULT = "v1";

export interface DecisionGradeSignal {
  signal_id: string;
  title: string;
  summary: string | null;
  domain: string | null;
  country: string | null;
  region: string | null;
  severity: string | null;
  confidence_score: number;
  relevance_score: number;
  urgency_score: number;
  impact_score: number;
  trend_direction: string | null;
  affected_sectors: string[];
  affected_entities: string[];
  why_it_matters: string | null;
  recommended_actions: string[];
  source_urls: string[];
  provenance: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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

export function clamp01_100(n: unknown, fallback = 0): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (x <= 1 && x >= 0) return Math.round(x * 100);
  return Math.max(0, Math.min(100, Math.round(x)));
}

export function toIso(d: unknown): string {
  if (!d) return new Date(0).toISOString();
  try { return new Date(d as string).toISOString(); } catch { return new Date(0).toISOString(); }
}

// Map raw global_signals row to decision-grade signal.
export function normalizeSignal(row: any, profile: ExportProfile, recsByCountryDomain: Map<string, string[]>): DecisionGradeSignal {
  const country = Array.isArray(row.affected_countries) && row.affected_countries.length ? String(row.affected_countries[0]).toUpperCase() : null;
  const domain = row.category ?? null;
  const recs = profile.include_recommendations
    ? (recsByCountryDomain.get(`${country ?? ""}::${domain ?? ""}`) ?? [])
    : [];
  return {
    signal_id: row.id,
    title: row.title ?? "",
    summary: row.summary ?? null,
    domain,
    country,
    region: Array.isArray(row.affected_regions) && row.affected_regions.length ? row.affected_regions[0] : null,
    severity: severityTier(clamp01_100(row.impact_score)),
    confidence_score: clamp01_100(row.confidence_score),
    relevance_score: clamp01_100(row.source_rank_score ?? row.confidence_score),
    urgency_score: clamp01_100(row.urgency_score),
    impact_score: clamp01_100(row.impact_score),
    trend_direction: row.trend_direction ?? null,
    affected_sectors: row.affected_sectors ?? [],
    affected_entities: row.affected_entities ?? [],
    why_it_matters: profile.include_explanations ? (row.why_it_matters ?? row.summary ?? null) : null,
    recommended_actions: recs,
    source_urls: profile.include_raw_source
      ? (Array.isArray(row.source_urls) ? row.source_urls : (row.primary_source ? [row.primary_source] : []))
      : [],
    provenance: {
      source: row.canonical_source_name ?? row.primary_source ?? null,
      trust_tier: row.source_trust_tier ?? null,
      ingestion: row.ingestion_source ?? null,
      evidence_hash: row.evidence_hash ?? null,
      merged_source_count: row.merged_source_count ?? 1,
      official_source_present: row.official_source_present ?? false,
      license: "AICIS-Public-Aggregate-1.0",
    },
    created_at: toIso(row.first_detected_at ?? row.created_at),
    updated_at: toIso(row.latest_update_at ?? row.created_at),
    export_generated_at: new Date().toISOString(),
  };
}

export function severityTier(impact: number): string {
  if (impact >= 80) return "critical";
  if (impact >= 60) return "high";
  if (impact >= 40) return "medium";
  if (impact >= 20) return "low";
  return "info";
}

// Dedupe + cluster signals: dedupe by dedup_key; cluster by (country,domain,day).
export function compressSignals(signals: DecisionGradeSignal[], opts: { prefer_clusters: boolean }) {
  // Dedup by signal_id (keep highest relevance)
  const byId = new Map<string, DecisionGradeSignal>();
  for (const s of signals) {
    const prev = byId.get(s.signal_id);
    if (!prev || s.relevance_score > prev.relevance_score) byId.set(s.signal_id, s);
  }
  const unique = [...byId.values()];

  if (!opts.prefer_clusters) return { signals: unique, clusters: [] as any[] };

  const groups = new Map<string, DecisionGradeSignal[]>();
  for (const s of unique) {
    const day = s.updated_at.slice(0, 10);
    const key = `${s.country ?? "XX"}::${s.domain ?? "unknown"}::${day}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const clusters: any[] = [];
  const standalone: DecisionGradeSignal[] = [];
  for (const [key, group] of groups) {
    if (group.length === 1) { standalone.push(group[0]); continue; }
    const [country, domain, day] = key.split("::");
    const avg = (k: keyof DecisionGradeSignal) =>
      Math.round(group.reduce((a, b) => a + (b[k] as number || 0), 0) / group.length);
    const top = group.slice().sort((a, b) => b.relevance_score - a.relevance_score)[0];
    clusters.push({
      cluster_id: `${country}-${domain}-${day}`,
      country, domain, day,
      signal_count: group.length,
      severity: severityTier(avg("impact_score")),
      confidence_score: avg("confidence_score"),
      relevance_score: avg("relevance_score"),
      urgency_score: avg("urgency_score"),
      impact_score: avg("impact_score"),
      lead_signal_id: top.signal_id,
      title: top.title,
      summary: top.summary,
      why_it_matters: top.why_it_matters,
      recommended_actions: Array.from(new Set(group.flatMap((g) => g.recommended_actions))).slice(0, 5),
      affected_entities: Array.from(new Set(group.flatMap((g) => g.affected_entities))).slice(0, 20),
      member_signal_ids: group.map((g) => g.signal_id),
      generated_at: new Date().toISOString(),
    });
  }
  return { signals: standalone, clusters };
}

export interface ExportValidationIssue { signal_id?: string; field: string; reason: string; }

export function validateExport(signals: DecisionGradeSignal[]): ExportValidationIssue[] {
  const issues: ExportValidationIssue[] = [];
  const seen = new Set<string>();
  for (const s of signals) {
    if (seen.has(s.signal_id)) issues.push({ signal_id: s.signal_id, field: "signal_id", reason: "duplicate" });
    seen.add(s.signal_id);
    if (!s.country) issues.push({ signal_id: s.signal_id, field: "country", reason: "missing" });
    if (!s.domain) issues.push({ signal_id: s.signal_id, field: "domain", reason: "missing" });
    if (!s.severity) issues.push({ signal_id: s.signal_id, field: "severity", reason: "missing" });
    for (const k of ["relevance_score", "confidence_score", "urgency_score", "impact_score"] as const) {
      const v = s[k];
      if (typeof v !== "number" || v < 0 || v > 100) issues.push({ signal_id: s.signal_id, field: k, reason: "out_of_range" });
    }
    if (s.source_urls === undefined) issues.push({ signal_id: s.signal_id, field: "source_urls", reason: "missing" });
    if (!s.provenance) issues.push({ signal_id: s.signal_id, field: "provenance", reason: "missing" });
    if (!/^\d{4}-\d{2}-\d{2}T/.test(s.created_at)) issues.push({ signal_id: s.signal_id, field: "created_at", reason: "not_iso" });
    if (!/^\d{4}-\d{2}-\d{2}T/.test(s.updated_at)) issues.push({ signal_id: s.signal_id, field: "updated_at", reason: "not_iso" });
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
  try { return JSON.parse(atob(c)); } catch { return null; }
}

// HMAC-SHA256 webhook signature: t=<unix>,v1=<hex>
export async function signWebhook(secret: string, body: string): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function rowsToCsv(cols: string[], rows: any[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") v = JSON.stringify(v);
    const s = String(v);
    return /[\",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map(esc).join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return rows.length ? `${head}\n${body}\n` : `${head}\n`;
}

// CORS
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-aicis-api-key",
  "Access-Control-Expose-Headers": "x-ratelimit-limit, x-ratelimit-remaining, x-schema-version, x-export-batch-id, x-next-cursor",
};

export function applyProfileFilters<T>(q: any, profile: ExportProfile) {
  if (profile.domains.length) q = q.in("category", profile.domains);
  if (profile.countries.length) q = q.overlaps("affected_countries", profile.countries);
  if (profile.regions.length) q = q.overlaps("affected_regions", profile.regions);
  if (profile.min_confidence_score > 0) q = q.gte("confidence_score", profile.min_confidence_score);
  if (profile.min_urgency_score > 0) q = q.gte("urgency_score", profile.min_urgency_score);
  return q;
}
