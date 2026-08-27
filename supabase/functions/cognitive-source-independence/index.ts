import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const FN = "cognitive-source-independence";
const METHOD = "explicit-source-lineage-v1";
const SEMANTICS =
  "independence_requires_complete_explicit_nonconflicting_lineage_distinct_source_ids_publishers_urls_do_not_establish_independence";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;
type LineageStatus = "unknown" | "verified_origin" | "verified_derived";
type AssessmentStatus = "not_assessed" | "partial" | "complete" | "conflicted";

type ClaimRow = {
  id: string;
  source_id: string;
  source_type: string;
  source_uri: string | null;
  source_published_at: string | null;
  evidence_hash: string | null;
  source_record_key: string | null;
  source_origin_key: string | null;
  source_lineage_status: LineageStatus;
  source_lineage_method: string | null;
  syndication_key: string | null;
  upstream_source_record_keys: string[] | null;
  source_lineage_evidence: JsonRecord | null;
};

type SourceRecord = {
  recordKey: string;
  claimIds: string[];
  sourceIds: string[];
  sourceTypes: string[];
  sourceUris: string[];
  evidenceHashes: string[];
  lineageStatuses: Set<LineageStatus>;
  originKeys: Set<string>;
  lineageMethods: Set<string>;
  syndicationKeys: Set<string>;
  upstreamKeys: Set<string>;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });

  const auth = await requireAdminOrTrustedWorker(req, cors);
  if (auth.response) return auth.response;

  const parsed = await req.json().catch(() => null);
  if (!isRecord(parsed)) return json({ error: "Request body must be an object" }, 400);
  const action = stringValue(parsed.action);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    if (action === "annotate_claim_source") {
      return await annotateClaimSource(supabase, parsed, auth.via ?? "admin");
    }
    if (action === "assess_claims") {
      return await assessClaims(supabase, parsed, auth.via ?? "admin");
    }
    return json({ error: "action must be annotate_claim_source or assess_claims" }, 400);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      function: FN,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return json({ error: error instanceof Error ? error.message : "source independence assessment failed" }, 400);
  }
});

async function annotateClaimSource(
  supabase: SupabaseClient,
  body: JsonRecord,
  authVia: string,
): Promise<Response> {
  const claimId = stringValue(body.claim_id);
  const lineageStatus = lineageStatusValue(body.source_lineage_status);
  if (!claimId || !lineageStatus) {
    return json({ error: "claim_id and valid source_lineage_status are required" }, 400);
  }

  const sourceRecordKey = stringValue(body.source_record_key);
  const sourceOriginKey = stringValue(body.source_origin_key);
  const sourceLineageMethod = stringValue(body.source_lineage_method);
  const syndicationKey = stringValue(body.syndication_key);
  const upstreamKeys = stringArray(body.upstream_source_record_keys);
  const evidence = isRecord(body.source_lineage_evidence) ? body.source_lineage_evidence : {};

  if (
    lineageStatus !== "unknown" &&
    (!sourceRecordKey || !sourceOriginKey || !sourceLineageMethod)
  ) {
    return json({
      error: "verified_origin/verified_derived require source_record_key, source_origin_key and source_lineage_method",
    }, 400);
  }

  const { data, error } = await supabase
    .from("aicis_evidence_claims")
    .update({
      source_record_key: sourceRecordKey,
      source_origin_key: lineageStatus === "unknown" ? null : sourceOriginKey,
      source_lineage_status: lineageStatus,
      source_lineage_method: lineageStatus === "unknown" ? null : sourceLineageMethod,
      syndication_key: syndicationKey,
      upstream_source_record_keys: upstreamKeys.length > 0 ? upstreamKeys : null,
      source_lineage_evidence: {
        ...evidence,
        annotation_auth_via: authVia,
        annotation_method: METHOD,
      },
    })
    .eq("id", claimId)
    .select("id,source_id,source_record_key,source_origin_key,source_lineage_status,source_lineage_method,syndication_key,upstream_source_record_keys")
    .maybeSingle();
  if (error) throw error;
  if (!data) return json({ error: "claim not found" }, 404);

  return json({
    success: true,
    claim: data,
    epistemic_contract: {
      source_lineage_status: lineageStatus,
      source_independence_inferred_from_distinct_source_id: false,
      source_independence_inferred_from_distinct_domain: false,
    },
  });
}

async function assessClaims(
  supabase: SupabaseClient,
  body: JsonRecord,
  authVia: string,
): Promise<Response> {
  const targetType = stringValue(body.target_type);
  const targetKey = stringValue(body.target_key);
  const claimIds = [...new Set(stringArray(body.claim_ids))];
  const allowedTargetTypes = new Set([
    "claim_set",
    "relationship",
    "hypothesis",
    "narrative",
    "cascade",
    "forecast",
  ]);

  if (!targetType || !allowedTargetTypes.has(targetType) || !targetKey) {
    return json({ error: "valid target_type and non-empty target_key are required" }, 400);
  }
  if (claimIds.length === 0 || claimIds.length > 500) {
    return json({ error: "claim_ids must contain 1 to 500 unique claim IDs" }, 400);
  }

  const claims: ClaimRow[] = [];
  for (let index = 0; index < claimIds.length; index += 200) {
    const { data, error } = await supabase
      .from("aicis_evidence_claims")
      .select("id,source_id,source_type,source_uri,source_published_at,evidence_hash,source_record_key,source_origin_key,source_lineage_status,source_lineage_method,syndication_key,upstream_source_record_keys,source_lineage_evidence")
      .in("id", claimIds.slice(index, index + 200));
    if (error) throw error;
    claims.push(...((data ?? []) as ClaimRow[]));
  }

  if (claims.length !== claimIds.length) {
    return json({
      error: "one or more claim_ids were not found",
      requested_claim_count: claimIds.length,
      found_claim_count: claims.length,
    }, 400);
  }

  const assessment = calculateAssessment(claims);
  const { data: persisted, error: insertError } = await supabase
    .from("aicis_source_independence_assessments")
    .insert({
      target_type: targetType,
      target_key: targetKey,
      claim_ids: claimIds,
      source_count: assessment.sourceCount,
      deduplicated_source_count: assessment.deduplicatedSourceCount,
      lineage_status: assessment.lineageStatus,
      known_origin_count: assessment.knownOriginCount,
      independent_origin_count: assessment.independentOriginCount,
      lineage_coverage: assessment.lineageCoverage,
      corroboration_status: assessment.corroborationStatus,
      method: METHOD,
      semantics: SEMANTICS,
      details: {
        ...assessment.details,
        auth_via: authVia,
      },
    })
    .select("id,assessed_at")
    .single();
  if (insertError) throw insertError;

  return json({
    success: true,
    assessment_id: persisted.id,
    assessed_at: persisted.assessed_at,
    target_type: targetType,
    target_key: targetKey,
    source_count: assessment.sourceCount,
    deduplicated_source_count: assessment.deduplicatedSourceCount,
    lineage_status: assessment.lineageStatus,
    known_origin_count: assessment.knownOriginCount,
    independent_origin_count: assessment.independentOriginCount,
    lineage_coverage: assessment.lineageCoverage,
    corroboration_status: assessment.corroborationStatus,
    semantics: SEMANTICS,
    details: assessment.details,
  });
}

function calculateAssessment(claims: ClaimRow[]) {
  const records = new Map<string, SourceRecord>();

  for (const claim of claims) {
    const recordKey = claim.source_record_key ||
      (claim.evidence_hash ? `evidence-hash:${claim.evidence_hash}` : null) ||
      (claim.source_uri ? `source-uri:${claim.source_uri}` : null) ||
      `claim:${claim.id}`;
    const current = records.get(recordKey) ?? {
      recordKey,
      claimIds: [],
      sourceIds: [],
      sourceTypes: [],
      sourceUris: [],
      evidenceHashes: [],
      lineageStatuses: new Set<LineageStatus>(),
      originKeys: new Set<string>(),
      lineageMethods: new Set<string>(),
      syndicationKeys: new Set<string>(),
      upstreamKeys: new Set<string>(),
    };
    current.claimIds.push(claim.id);
    current.sourceIds.push(claim.source_id);
    current.sourceTypes.push(claim.source_type);
    if (claim.source_uri) current.sourceUris.push(claim.source_uri);
    if (claim.evidence_hash) current.evidenceHashes.push(claim.evidence_hash);
    current.lineageStatuses.add(claim.source_lineage_status ?? "unknown");
    if (claim.source_origin_key) current.originKeys.add(claim.source_origin_key);
    if (claim.source_lineage_method) current.lineageMethods.add(claim.source_lineage_method);
    if (claim.syndication_key) current.syndicationKeys.add(claim.syndication_key);
    for (const key of claim.upstream_source_record_keys ?? []) current.upstreamKeys.add(key);
    records.set(recordKey, current);
  }

  const recordList = [...records.values()];
  const conflicts: string[] = [];
  const completeRecords: SourceRecord[] = [];
  const unknownRecordKeys: string[] = [];

  for (const record of recordList) {
    const verifiedStatuses = [...record.lineageStatuses].filter((status) => status !== "unknown");
    const recordConflict =
      verifiedStatuses.length > 1 ||
      record.originKeys.size > 1 ||
      record.lineageMethods.size > 1;
    if (recordConflict) {
      conflicts.push(`conflicting lineage annotations for ${record.recordKey}`);
      continue;
    }

    const status = verifiedStatuses[0] ?? "unknown";
    if (
      status !== "unknown" &&
      record.originKeys.size === 1 &&
      record.lineageMethods.size === 1
    ) {
      completeRecords.push(record);
    } else {
      unknownRecordKeys.push(record.recordKey);
    }
  }

  const duplicateHashGroups = groupRecords(recordList, (record) => record.evidenceHashes);
  const syndicationGroups = groupRecords(recordList, (record) => [...record.syndicationKeys]);

  for (const group of [...duplicateHashGroups, ...syndicationGroups]) {
    const origins = new Set(
      group.recordKeys.flatMap((recordKey) => [...(records.get(recordKey)?.originKeys ?? [])]),
    );
    if (origins.size > 1) {
      conflicts.push(
        `dependent-source cluster ${group.key} has conflicting explicit origin keys: ${[...origins].join(", ")}`,
      );
    }
  }

  const originKeys = new Set(completeRecords.flatMap((record) => [...record.originKeys]));
  const lineageCoverage = recordList.length === 0
    ? 0
    : completeRecords.length / recordList.length;

  let lineageStatus: AssessmentStatus;
  let independentOriginCount: number | null = null;
  let corroborationStatus: "not_established" | "established" | "conflicted";

  if (conflicts.length > 0) {
    lineageStatus = "conflicted";
    corroborationStatus = "conflicted";
  } else if (recordList.length > 0 && completeRecords.length === recordList.length) {
    lineageStatus = "complete";
    independentOriginCount = originKeys.size;
    corroborationStatus = independentOriginCount >= 2 ? "established" : "not_established";
  } else if (
    completeRecords.length > 0 ||
    duplicateHashGroups.length > 0 ||
    syndicationGroups.length > 0
  ) {
    lineageStatus = "partial";
    corroborationStatus = "not_established";
  } else {
    lineageStatus = "not_assessed";
    corroborationStatus = "not_established";
  }

  return {
    sourceCount: claims.length,
    deduplicatedSourceCount: recordList.length,
    lineageStatus,
    knownOriginCount: originKeys.size,
    independentOriginCount,
    lineageCoverage,
    corroborationStatus,
    details: {
      record_keys: recordList.map((record) => record.recordKey),
      complete_lineage_record_keys: completeRecords.map((record) => record.recordKey),
      unknown_lineage_record_keys: unknownRecordKeys,
      duplicate_evidence_hash_groups: duplicateHashGroups,
      syndication_groups: syndicationGroups,
      conflicts,
      distinct_source_ids: [...new Set(claims.map((claim) => claim.source_id))],
      distinct_source_ids_are_independence_evidence: false,
      distinct_source_types: [...new Set(claims.map((claim) => claim.source_type))],
      distinct_source_types_are_independence_evidence: false,
    },
  };
}

function groupRecords(
  records: SourceRecord[],
  keySelector: (record: SourceRecord) => string[],
): Array<{ key: string; recordKeys: string[] }> {
  const groups = new Map<string, Set<string>>();
  for (const record of records) {
    for (const key of keySelector(record)) {
      const members = groups.get(key) ?? new Set<string>();
      members.add(record.recordKey);
      groups.set(key, members);
    }
  }
  return [...groups.entries()]
    .filter(([, members]) => members.size > 1)
    .map(([key, members]) => ({ key, recordKeys: [...members] }));
}

function lineageStatusValue(value: unknown): LineageStatus | null {
  return value === "unknown" || value === "verified_origin" || value === "verified_derived"
    ? value
    : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = stringValue(item);
    return text ? [text] : [];
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, ...extraHeaders, "content-type": "application/json" },
  });
}
