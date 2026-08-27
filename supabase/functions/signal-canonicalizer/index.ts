import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const FN = "signal-canonicalizer";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const BATCH = 1000;
const MAX_UPDATES_PER_RUN = 1500;
const SIM_THRESHOLD = 0.55;
const SIM_THRESHOLD_NO_GEO = 0.75;
const SIM_THRESHOLD_CROSS_CATEGORY = 0.85;
const WINDOW_HOURS = 24;
const WINDOW_HOURS_CROSS_CATEGORY = 6;
const MS_PER_HOUR = 3_600_000;
const SIGNAL_SCORE_SEMANTICS =
  "deterministic_source_registry_trust_and_source_event_recency_screen_v1_not_probability_source_independence_excluded";
const SOURCE_IDENTIFIER_SEMANTICS =
  "distinct_source_identifier_count_descriptive_only_not_source_independence";
const SOURCE_INDEPENDENCE_SEMANTICS =
  "explicit_signal_source_origin_lineage_required_absence_never_implies_independence";
const DUPLICATE_CANDIDATE_SEMANTICS =
  "title_trigram_time_geography_similarity_candidate_not_same_event_identity";

type Sig = {
  id: string;
  title: string;
  category: string | null;
  affected_countries: string[] | null;
  occurred_at: string | null;
  first_detected_at: string;
  ingested_at?: string | null;
  primary_source: string | null;
  canonical_source_name: string | null;
  ingestion_source: string | null;
  canonical_event_id?: string | null;
  source_record_key?: string | null;
  source_origin_key?: string | null;
  source_lineage_status?: "unknown" | "verified_origin" | "verified_derived" | null;
  source_lineage_method?: string | null;
  syndication_key?: string | null;
};

type TrustRow = {
  tier: string;
  credibility_score: number;
  propaganda_risk_score: number;
  is_official: boolean;
};

type CandidateTarget = Sig & { canonical_event_id: string };

type LineageAssessment = {
  status: "not_assessed" | "partial" | "complete_not_corroborated" | "established" | "conflicted";
  independentOriginCount: number | null;
  coveredRows: number;
  rowCount: number;
  originKeys: string[];
};

type EvidenceScreen = {
  score: number | null;
  recencyFactor: number | null;
  officialBoost: number;
  propagandaPenalty: number | null;
};

function normTitle(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value}  `;
  const result = new Set<string>();
  for (let index = 0; index < padded.length - 2; index += 1) {
    result.add(padded.slice(index, index + 3));
  }
  return result;
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function comparisonTimestamp(signal: Sig): string {
  return signal.occurred_at || signal.first_detected_at;
}

function hoursBetween(left: string, right: string): number | null {
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / MS_PER_HOUR;
}

function countriesOverlap(
  left: string[] | null,
  right: string[] | null,
): { overlap: boolean; bothEmpty: boolean } {
  const leftEmpty = !left || left.length === 0;
  const rightEmpty = !right || right.length === 0;
  if (leftEmpty && rightEmpty) return { overlap: true, bothEmpty: true };
  if (leftEmpty || rightEmpty) return { overlap: false, bothEmpty: false };
  const values = new Set(left);
  return { overlap: right.some((value) => values.has(value)), bothEmpty: false };
}

function sourceName(signal: Sig): string | null {
  const value = signal.canonical_source_name || signal.primary_source;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function loadTrust(
  supabase: ReturnType<typeof createClient>,
): Promise<Array<{ pattern: string; row: TrustRow }>> {
  const { data, error } = await supabase
    .from("signal_source_trust_registry")
    .select("pattern,tier,credibility_score,propaganda_risk_score,is_official")
    .neq("pattern", "__default__");
  if (error) throw error;

  return (data ?? [])
    .map((row) => ({
      pattern: String(row.pattern),
      row: {
        tier: String(row.tier),
        credibility_score: Number(row.credibility_score),
        propaganda_risk_score: Number(row.propaganda_risk_score),
        is_official: Boolean(row.is_official),
      },
    }))
    .sort((left, right) => right.pattern.length - left.pattern.length);
}

function resolveTrust(
  name: string | null,
  registry: Array<{ pattern: string; row: TrustRow }>,
): TrustRow | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const { pattern, row } of registry) {
    const expression = new RegExp(
      `^${pattern
        .toLowerCase()
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")}$`,
    );
    if (expression.test(lower)) return row;
  }
  return null;
}

function computeEvidenceScreen(signal: Sig, trust: TrustRow | null): EvidenceScreen {
  if (!trust) {
    return { score: null, recencyFactor: null, officialBoost: 0, propagandaPenalty: null };
  }

  let recencyFactor: number | null = null;
  if (signal.occurred_at) {
    const age = hoursBetween(new Date().toISOString(), signal.occurred_at);
    if (age !== null) recencyFactor = Math.max(0, 1 - age / 72);
  }

  const officialBoost = trust.is_official ? 8 : 0;
  const propagandaPenalty = Math.round(trust.propaganda_risk_score * 0.25);
  const recencyBonus = recencyFactor === null ? 0 : recencyFactor * 8;
  const raw =
    trust.credibility_score * 0.6 +
    officialBoost +
    recencyBonus -
    propagandaPenalty;

  return {
    score: Math.max(0, Math.min(100, Math.round(raw))),
    recencyFactor,
    officialBoost,
    propagandaPenalty,
  };
}

function assessLineage(rows: Sig[]): LineageAssessment {
  if (rows.length === 0) {
    return { status: "not_assessed", independentOriginCount: null, coveredRows: 0, rowCount: 0, originKeys: [] };
  }

  const origins = new Set<string>();
  const recordOrigins = new Map<string, string>();
  const syndicationOrigins = new Map<string, string>();
  let coveredRows = 0;
  let conflicted = false;

  for (const row of rows) {
    const status = row.source_lineage_status ?? "unknown";
    const origin = row.source_origin_key?.trim() || null;
    if ((status === "verified_origin" || status === "verified_derived") && origin) {
      coveredRows += 1;
      origins.add(origin);

      const recordKey = row.source_record_key?.trim();
      if (recordKey) {
        const existing = recordOrigins.get(recordKey);
        if (existing && existing !== origin) conflicted = true;
        recordOrigins.set(recordKey, origin);
      }

      const syndicationKey = row.syndication_key?.trim();
      if (syndicationKey) {
        const existing = syndicationOrigins.get(syndicationKey);
        if (existing && existing !== origin) conflicted = true;
        syndicationOrigins.set(syndicationKey, origin);
      }
    }
  }

  const originKeys = [...origins].sort();
  if (conflicted) {
    return {
      status: "conflicted",
      independentOriginCount: null,
      coveredRows,
      rowCount: rows.length,
      originKeys,
    };
  }
  if (coveredRows === 0) {
    return {
      status: "not_assessed",
      independentOriginCount: null,
      coveredRows,
      rowCount: rows.length,
      originKeys,
    };
  }
  if (coveredRows !== rows.length) {
    return {
      status: "partial",
      independentOriginCount: null,
      coveredRows,
      rowCount: rows.length,
      originKeys,
    };
  }

  return {
    status: origins.size >= 2 ? "established" : "complete_not_corroborated",
    independentOriginCount: origins.size,
    coveredRows,
    rowCount: rows.length,
    originKeys,
  };
}

function canonicalEvidencePatch(
  canonical: Sig,
  members: Sig[],
  registry: Array<{ pattern: string; row: TrustRow }>,
) {
  const names = new Set(
    members
      .map(sourceName)
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase()),
  );
  const trust = resolveTrust(sourceName(canonical), registry);
  const screen = computeEvidenceScreen(canonical, trust);
  const lineage = assessLineage(members);
  const sourceIndependenceEstablished = lineage.status === "established" &&
    lineage.independentOriginCount !== null &&
    lineage.independentOriginCount >= 2;

  return {
    source_credibility_score: trust?.credibility_score ?? null,
    propaganda_risk_score: trust?.propaganda_risk_score ?? null,
    source_trust_tier: trust?.tier ?? "unknown",
    official_source: trust?.is_official ?? false,
    source_identifier_count: names.size,
    source_identifier_count_semantics: SOURCE_IDENTIFIER_SEMANTICS,
    source_independence_status: lineage.status,
    independent_origin_count: lineage.independentOriginCount,
    source_independence_semantics: SOURCE_INDEPENDENCE_SEMANTICS,
    corroboration_count: lineage.independentOriginCount,
    corroboration_count_semantics: lineage.independentOriginCount === null
      ? "withheld_incomplete_or_conflicted_signal_source_lineage"
      : "explicit_independent_origin_count_from_complete_signal_source_lineage",
    multi_source_confirmed: sourceIndependenceEstablished ? true : null,
    multi_source_confirmation_semantics: sourceIndependenceEstablished
      ? "confirmed_by_complete_signal_source_lineage_with_at_least_two_explicit_origins"
      : "not_established_without_at_least_two_explicit_independent_origins",
    confidence_score: screen.score,
    confidence_score_semantics: screen.score === null
      ? "withheld_no_registered_source_trust_evidence"
      : SIGNAL_SCORE_SEMANTICS,
    confidence_explanation: {
      role: "canonical",
      score_semantics: screen.score === null
        ? "withheld_no_registered_source_trust_evidence"
        : SIGNAL_SCORE_SEMANTICS,
      source_tier: trust?.tier ?? null,
      source_credibility: trust?.credibility_score ?? null,
      propaganda_risk: trust?.propaganda_risk_score ?? null,
      official_source: trust?.is_official ?? null,
      source_event_recency_factor: screen.recencyFactor,
      official_source_heuristic_boost: screen.officialBoost,
      propaganda_risk_heuristic_penalty: screen.propagandaPenalty,
      distinct_source_identifiers: names.size,
      distinct_source_identifiers_are_score_input: false,
      source_independence_status: lineage.status,
      independent_origin_count: lineage.independentOriginCount,
      source_lineage_covered_rows: lineage.coveredRows,
      source_lineage_row_count: lineage.rowCount,
      source_origin_keys: lineage.originKeys,
      formula: "0.6*registryCredibility + officialHeuristic(8) + sourceEventRecency*8 - 0.25*registryPropagandaRisk; publisher/source count excluded",
      probability_semantics: "not_a_probability",
    },
  };
}

async function loadCanonicalMembers(
  supabase: ReturnType<typeof createClient>,
  canonicalId: string,
): Promise<Sig[]> {
  const { data: canonical, error: canonicalError } = await supabase
    .from("global_signals")
    .select("id,title,category,affected_countries,occurred_at,first_detected_at,ingested_at,primary_source,canonical_source_name,ingestion_source,canonical_event_id,source_record_key,source_origin_key,source_lineage_status,source_lineage_method,syndication_key")
    .eq("id", canonicalId)
    .maybeSingle();
  if (canonicalError) throw canonicalError;
  if (!canonical) return [];

  const { data: duplicates, error: duplicateError } = await supabase
    .from("global_signals")
    .select("id,title,category,affected_countries,occurred_at,first_detected_at,ingested_at,primary_source,canonical_source_name,ingestion_source,canonical_event_id,source_record_key,source_origin_key,source_lineage_status,source_lineage_method,syndication_key")
    .eq("canonical_event_id", canonicalId)
    .eq("canonical_event_status", "duplicate")
    .eq("duplicate_match_status", "verified");
  if (duplicateError) throw duplicateError;

  return [canonical as Sig, ...((duplicates ?? []) as Sig[])];
}

async function recomputeCanonical(
  supabase: ReturnType<typeof createClient>,
  canonicalId: string,
  registry: Array<{ pattern: string; row: TrustRow }>,
) {
  const members = await loadCanonicalMembers(supabase, canonicalId);
  if (members.length === 0) return;
  const canonical = members[0];
  const patch = canonicalEvidencePatch(canonical, members, registry);
  const { error } = await supabase.from("global_signals").update(patch).eq("id", canonicalId);
  if (error) throw error;
}

async function reviewDuplicate(
  supabase: ReturnType<typeof createClient>,
  registry: Array<{ pattern: string; row: TrustRow }>,
  body: Record<string, unknown>,
  reviewerId: string | null,
) {
  const candidateId = typeof body.candidate_signal_id === "string" ? body.candidate_signal_id : "";
  const decision = body.decision === "accept" || body.decision === "reject" ? body.decision : null;
  if (!candidateId || !decision) {
    return json({ error: "candidate_signal_id and decision=accept|reject are required" }, 400);
  }

  const { data: candidate, error: candidateError } = await supabase
    .from("global_signals")
    .select("id,candidate_duplicate_of_signal_id,duplicate_match_status,canonical_event_status")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateError) throw candidateError;
  if (!candidate || candidate.duplicate_match_status !== "candidate") {
    return json({ error: "Pending duplicate candidate not found" }, 404);
  }

  if (decision === "reject") {
    const { error } = await supabase.from("global_signals").update({
      duplicate_match_status: "rejected",
      duplicate_reviewed_at: new Date().toISOString(),
      duplicate_reviewed_by: reviewerId,
      duplicate_match_semantics: `${DUPLICATE_CANDIDATE_SEMANTICS}; human_review_rejected_same_event_identity`,
    }).eq("id", candidateId);
    if (error) throw error;
    return json({ ok: true, candidate_signal_id: candidateId, decision: "reject" });
  }

  const targetId = candidate.candidate_duplicate_of_signal_id;
  if (!targetId) return json({ error: "Candidate has no duplicate target" }, 409);

  const { data: target, error: targetError } = await supabase
    .from("global_signals")
    .select("id,canonical_event_id,canonical_event_status")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target || target.canonical_event_status !== "canonical") {
    return json({ error: "Candidate target is no longer canonical" }, 409);
  }

  const canonicalId = target.canonical_event_id || target.id;
  const { error: updateError } = await supabase.from("global_signals").update({
    canonical_event_id: canonicalId,
    duplicate_of_signal_id: target.id,
    canonical_event_status: "duplicate",
    duplicate_match_status: "verified",
    duplicate_reviewed_at: new Date().toISOString(),
    duplicate_reviewed_by: reviewerId,
    duplicate_match_semantics: `${DUPLICATE_CANDIDATE_SEMANTICS}; human_review_verified_same_event_identity`,
  }).eq("id", candidateId);
  if (updateError) throw updateError;

  await recomputeCanonical(supabase, canonicalId, registry);
  return json({
    ok: true,
    candidate_signal_id: candidateId,
    canonical_event_id: canonicalId,
    decision: "accept",
    automatic_identity_promotion: false,
  });
}

async function scanCanonicalization(
  supabase: ReturnType<typeof createClient>,
  registry: Array<{ pattern: string; row: TrustRow }>,
) {
  const startedAt = Date.now();
  const { data: pending, error: pendingError } = await supabase
    .from("global_signals")
    .select("id,title,category,affected_countries,occurred_at,first_detected_at,ingested_at,primary_source,canonical_source_name,ingestion_source,source_record_key,source_origin_key,source_lineage_status,source_lineage_method,syndication_key")
    .is("canonical_event_status", null)
    .order("first_detected_at", { ascending: true })
    .limit(BATCH);
  if (pendingError) throw pendingError;

  const pendingSignals = (pending ?? []) as Sig[];
  if (pendingSignals.length === 0) {
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "success",
      message: "No pending signals.",
    });
    return json({ processed: 0, new_canonicals: 0, duplicate_candidates: 0 });
  }

  const earliest = pendingSignals[0].first_detected_at;
  const earliestMs = new Date(earliest).getTime();
  const sinceTs = Number.isFinite(earliestMs)
    ? new Date(earliestMs - WINDOW_HOURS * MS_PER_HOUR).toISOString()
    : new Date(0).toISOString();

  const { data: recent, error: recentError } = await supabase
    .from("global_signals")
    .select("id,title,category,affected_countries,occurred_at,first_detected_at,ingested_at,primary_source,canonical_source_name,ingestion_source,canonical_event_id,source_record_key,source_origin_key,source_lineage_status,source_lineage_method,syndication_key")
    .eq("canonical_event_status", "canonical")
    .gte("first_detected_at", sinceTs)
    .limit(5000);
  if (recentError) throw recentError;

  const candidateTargets: CandidateTarget[] = (recent ?? []).map((row) => ({
    ...(row as Sig),
    canonical_event_id: String(row.canonical_event_id || row.id),
  }));

  let written = 0;
  let candidateCount = 0;
  for (const signal of pendingSignals) {
    if (written >= MAX_UPDATES_PER_RUN) break;

    const normalizedTitle = normTitle(signal.title);
    const signalTs = comparisonTimestamp(signal);
    let best: { target: CandidateTarget; similarity: number } | null = null;

    for (const target of candidateTargets) {
      const deltaHours = hoursBetween(comparisonTimestamp(target), signalTs);
      if (deltaHours === null) continue;
      const sameCategory = target.category === signal.category;
      const windowHours = sameCategory ? WINDOW_HOURS : WINDOW_HOURS_CROSS_CATEGORY;
      if (deltaHours > windowHours) continue;

      const geography = countriesOverlap(target.affected_countries, signal.affected_countries);
      if (!geography.overlap) continue;

      const score = similarity(normTitle(target.title), normalizedTitle);
      let threshold = SIM_THRESHOLD;
      if (!sameCategory) threshold = SIM_THRESHOLD_CROSS_CATEGORY;
      else if (geography.bothEmpty) threshold = SIM_THRESHOLD_NO_GEO;

      if (score >= threshold && (!best || score > best.similarity)) {
        best = { target, similarity: score };
      }
    }

    const nowIso = new Date().toISOString();
    const ingestReference = signal.ingested_at || signal.first_detected_at;
    const ingestMs = ingestReference ? new Date(ingestReference).getTime() : Number.NaN;
    const canonicalizationLatencySeconds = Number.isFinite(ingestMs)
      ? Math.max(0, Math.round((Date.now() - ingestMs) / 1000))
      : null;
    const canonicalId = signal.id;
    const evidencePatch = canonicalEvidencePatch(signal, [signal], registry);

    const patch = {
      canonical_event_id: canonicalId,
      duplicate_of_signal_id: null,
      canonical_event_status: "canonical",
      canonicalized_at: nowIso,
      last_pipeline_stage: "canonicalized",
      canonicalization_latency_seconds: canonicalizationLatencySeconds,
      candidate_duplicate_of_signal_id: best?.target.id ?? null,
      candidate_canonical_event_id: best?.target.canonical_event_id ?? null,
      duplicate_match_status: best ? "candidate" : "not_assessed",
      duplicate_similarity_score: best ? Number(best.similarity.toFixed(3)) : null,
      duplicate_match_semantics: best ? DUPLICATE_CANDIDATE_SEMANTICS : null,
      novelty_score: best ? Math.max(0, Math.round((1 - best.similarity) * 100)) : 100,
      ...evidencePatch,
    };

    const { error } = await supabase.from("global_signals").update(patch).eq("id", signal.id);
    if (error) throw error;
    written += 1;
    if (best) candidateCount += 1;

    candidateTargets.push({ ...signal, canonical_event_id: canonicalId });
  }

  const duration = Date.now() - startedAt;
  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: "success",
    message: `Processed ${written} | canonicals ${written} | duplicate review candidates ${candidateCount} | ${duration}ms`,
  });

  return json({
    processed: written,
    new_canonicals: written,
    duplicate_candidates: candidateCount,
    automatic_duplicates_created: 0,
    automatic_identity_promotion: false,
    duration_ms: duration,
    capped: pendingSignals.length > written,
    signal_score_semantics: SIGNAL_SCORE_SEMANTICS,
    duplicate_candidate_semantics: DUPLICATE_CANDIDATE_SEMANTICS,
  });
}

Deno.serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = typeof body.action === "string" ? body.action : "scan";
    const registry = await loadTrust(supabase);

    if (action === "review_duplicate") {
      const reviewer = callerAuth.user as { id?: unknown } | null;
      const reviewerId = typeof reviewer?.id === "string" ? reviewer.id : null;
      return await reviewDuplicate(supabase, registry, body, reviewerId);
    }
    if (action !== "scan") return json({ error: `Unknown action: ${action}` }, 400);
    return await scanCanonicalization(supabase, registry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${FN} error:`, message);
    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: "error",
      message: message.slice(0, 500),
    });
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}