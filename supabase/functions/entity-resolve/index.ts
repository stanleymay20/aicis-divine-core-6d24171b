import {
  requireAdminOrTrustedWorker,
  requireUserOrTrustedWorker,
} from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "entity-resolve";
const WRITE_ACTIONS = new Set(["register", "link", "merge", "review_candidate"]);

type RecordValue = Record<string, unknown>;

type Candidate = {
  entity: RecordValue;
  match_type: "exact_name" | "alias" | "fuzzy" | "iso3";
  match_score: number | null;
  match_score_semantics: string;
  evidence: RecordValue;
};

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  let body: RecordValue;
  try {
    const parsed = await req.json();
    if (!isRecord(parsed)) throw new Error("Request body must be a JSON object");
    body = parsed;
  } catch (error) {
    return errorResponse(error, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!action) return errorResponse(new Error("action is required"), 400);

  let actorUserId: string | null = null;
  let actor = "unknown";
  if (WRITE_ACTIONS.has(action)) {
    const auth = await requireAdminOrTrustedWorker(req);
    if (auth.response) return auth.response;
    const user = isRecord(auth.user) ? auth.user : null;
    actorUserId = typeof user?.id === "string" ? user.id : null;
    actor = actorUserId ? `admin:${actorUserId}` : auth.via ?? "trusted_worker";
  } else {
    const auth = await requireUserOrTrustedWorker(req);
    if (auth.response) return auth.response;
    actorUserId = typeof auth.ctx?.user?.id === "string" ? auth.ctx.user.id : null;
    actor = actorUserId ? `user:${actorUserId}` : auth.via ?? "trusted_worker";
  }

  const { action: _action, ...params } = body;
  void _action;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    switch (action) {
      case "resolve": return await resolveEntity(supabase, params);
      case "register": return await registerEntity(supabase, params, actor);
      case "link": return await linkEntities(supabase, params, actor);
      case "merge": return await mergeEntities(supabase, params, actor);
      case "review_candidate": return await reviewCandidate(supabase, params, actorUserId, actor);
      case "search": return await searchEntities(supabase, params);
      case "graph": return await getEntityGraph(supabase, params);
      default: return errorResponse(new Error(`Unknown action: ${action}`), 400);
    }
  } catch (error) {
    structuredLog("error", FN, error instanceof Error ? error.message : String(error));
    return errorResponse(error);
  }
});

async function resolveEntity(supabase: ReturnType<typeof createClient>, params: RecordValue) {
  const name = stringValue(params.name);
  const entityType = stringValue(params.entity_type);
  const iso3 = stringValue(params.iso3)?.toUpperCase() ?? null;
  const externalIds = Array.isArray(params.external_ids) ? params.external_ids : [];
  if (!name || !entityType) {
    return errorResponse(new Error("name and entity_type required"), 400);
  }

  // Previously reviewed mappings are explicit human evidence and may be reused.
  const acceptedQuery = supabase
    .from("entity_resolution_candidates")
    .select("id,candidate_entity_id,evidence,canonical_entities(*)")
    .eq("requested_entity_type", entityType)
    .eq("status", "accepted")
    .ilike("requested_name", name)
    .order("reviewed_at", { ascending: false })
    .limit(1);
  const { data: acceptedRows } = iso3
    ? await acceptedQuery.eq("requested_iso3", iso3)
    : await acceptedQuery.is("requested_iso3", null);
  const accepted = acceptedRows?.[0] as RecordValue | undefined;
  if (accepted && isRecord(accepted.canonical_entities)) {
    return jsonResponse({
      resolved: true,
      resolution_status: "resolved_by_reviewed_mapping",
      entity: accepted.canonical_entities,
      match_type: "reviewed_candidate",
      match_confidence: null,
      match_confidence_semantics: "not_issued_identity_resolution_is_a_reviewed_decision_not_probability",
      candidate_record_id: accepted.id,
    });
  }

  // Only explicitly verified external identifiers may auto-resolve.
  for (const rawExt of externalIds) {
    if (!isRecord(rawExt)) continue;
    const provider = stringValue(rawExt.provider);
    const externalId = stringValue(rawExt.external_id);
    if (!provider || !externalId) continue;

    const { data: extMatch } = await supabase
      .from("entity_external_ids")
      .select("entity_id,verification_status,verification_method,last_verified_at,canonical_entities(*)")
      .eq("provider", provider)
      .eq("external_id", externalId)
      .eq("verification_status", "verified")
      .limit(1)
      .maybeSingle();

    if (extMatch && isRecord(extMatch.canonical_entities)) {
      return jsonResponse({
        resolved: true,
        resolution_status: "resolved_by_verified_external_identifier",
        entity: extMatch.canonical_entities,
        match_type: "external_id",
        match_confidence: null,
        match_confidence_semantics: "not_issued_authoritative_identifier_match_is_not_probability",
        matched_provider: provider,
        verification_method: extMatch.verification_method ?? null,
        last_verified_at: extMatch.last_verified_at ?? null,
      });
    }
  }

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidate: Candidate) => {
    const id = stringValue(candidate.entity.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    candidates.push(candidate);
  };

  const normalizedName = name.toLowerCase().trim();
  const { data: exactRows } = await supabase
    .from("canonical_entities")
    .select("*")
    .eq("entity_type", entityType)
    .eq("normalized_name", normalizedName)
    .limit(10);
  for (const row of exactRows ?? []) {
    addCandidate({
      entity: row as RecordValue,
      match_type: "exact_name",
      match_score: null,
      match_score_semantics: "exact_normalized_name_match_not_identity_probability",
      evidence: { normalized_name: normalizedName },
    });
  }

  const { data: aliasRows } = await supabase
    .from("entity_aliases")
    .select("entity_id,alias,verification_status,canonical_entities(*)")
    .ilike("alias", name)
    .limit(10);
  for (const row of aliasRows ?? []) {
    if (!isRecord(row.canonical_entities)) continue;
    addCandidate({
      entity: row.canonical_entities,
      match_type: "alias",
      match_score: null,
      match_score_semantics: "exact_alias_text_match_not_identity_probability",
      evidence: {
        alias: row.alias,
        alias_verification_status: row.verification_status ?? null,
      },
    });
  }

  if (iso3 && entityType === "country") {
    const { data: isoRows } = await supabase
      .from("canonical_entities")
      .select("*")
      .eq("entity_type", "country")
      .eq("iso3", iso3)
      .limit(10);
    for (const row of isoRows ?? []) {
      addCandidate({
        entity: row as RecordValue,
        match_type: "iso3",
        match_score: null,
        match_score_semantics: "stored_iso3_equality_not_authoritative_verification",
        evidence: { iso3 },
      });
    }
  }

  const { data: fuzzyRows } = await supabase.rpc("similarity_search_entities", {
    search_name: name,
    search_type: entityType,
    min_similarity: 0.3,
    max_results: 5,
  });
  for (const row of fuzzyRows ?? []) {
    const score = unitOrNull(row.similarity);
    addCandidate({
      entity: row as RecordValue,
      match_type: "fuzzy",
      match_score: score,
      match_score_semantics: "trigram_string_similarity_not_identity_probability",
      evidence: { match_source: row.match_source ?? null },
    });
  }

  const persisted = await persistCandidates(supabase, {
    requestedName: name,
    requestedEntityType: entityType,
    requestedIso3: iso3,
    candidates,
  });

  if (candidates.length > 0) {
    return jsonResponse({
      resolved: false,
      resolution_status: "candidate_review_required",
      candidates: candidates.map((candidate, index) => ({
        entity: candidate.entity,
        match_type: candidate.match_type,
        match_score: candidate.match_score,
        match_score_semantics: candidate.match_score_semantics,
        evidence: candidate.evidence,
        candidate_record_id: persisted[index] ?? null,
      })),
      source_independence_assessed: false,
      searched: { name, entity_type: entityType, iso3 },
    });
  }

  return jsonResponse({
    resolved: false,
    resolution_status: "unresolved_no_candidate",
    candidates: [],
    suggestion: "An administrator may register a new canonical entity after evidence review",
    searched: { name, entity_type: entityType, iso3 },
  });
}

async function persistCandidates(
  supabase: ReturnType<typeof createClient>,
  input: {
    requestedName: string;
    requestedEntityType: string;
    requestedIso3: string | null;
    candidates: Candidate[];
  },
): Promise<Array<string | null>> {
  if (input.candidates.length === 0) return [];
  const rows = input.candidates.map((candidate) => ({
    requested_name: input.requestedName,
    requested_entity_type: input.requestedEntityType,
    requested_iso3: input.requestedIso3,
    candidate_entity_id: candidate.entity.id,
    match_type: candidate.match_type,
    match_score: candidate.match_score,
    match_score_semantics: candidate.match_score_semantics,
    evidence: candidate.evidence,
    status: "pending_review",
  }));
  const { data, error } = await supabase
    .from("entity_resolution_candidates")
    .insert(rows)
    .select("id");
  if (error) {
    structuredLog("warn", FN, `candidate persistence failed: ${error.message}`);
    return rows.map(() => null);
  }
  return (data ?? []).map((row) => stringValue(row.id));
}

async function reviewCandidate(
  supabase: ReturnType<typeof createClient>,
  params: RecordValue,
  actorUserId: string | null,
  actor: string,
) {
  const candidateId = stringValue(params.candidate_id);
  const decision = stringValue(params.decision);
  if (!candidateId || (decision !== "accepted" && decision !== "rejected")) {
    return errorResponse(new Error("candidate_id and decision=accepted|rejected are required"), 400);
  }

  const { data, error } = await supabase
    .from("entity_resolution_candidates")
    .update({
      status: decision,
      reviewed_at: new Date().toISOString(),
      reviewed_by: actorUserId,
    })
    .eq("id", candidateId)
    .eq("status", "pending_review")
    .select("id,candidate_entity_id,status")
    .maybeSingle();
  if (error) return errorResponse(error);
  if (!data) return errorResponse(new Error("Pending candidate not found"), 404);

  structuredLog("info", FN, `${actor} ${decision} entity resolution candidate ${candidateId}`);
  return jsonResponse({ ok: true, candidate: data, decision });
}

async function registerEntity(
  supabase: ReturnType<typeof createClient>,
  params: RecordValue,
  actor: string,
) {
  const name = stringValue(params.name);
  const entityType = stringValue(params.entity_type);
  if (!name || !entityType) return errorResponse(new Error("name and entity_type required"), 400);

  const aliases = Array.isArray(params.aliases) ? params.aliases : [];
  const externalIds = Array.isArray(params.external_ids) ? params.external_ids : [];
  const metadata = isRecord(params.metadata) ? params.metadata : {};

  const { data: entity, error } = await supabase
    .from("canonical_entities")
    .insert({
      entity_type: entityType,
      canonical_name: name,
      display_name: stringValue(params.display_name) ?? name,
      iso3: stringValue(params.iso3),
      lat: finiteOrNull(params.lat),
      lon: finiteOrNull(params.lon),
      metadata,
      trust_score: null,
      trust_score_semantics: "not_quantified_registration_is_not_trust_measurement",
      source_count: null,
      evidence_status: "registered_identity_not_independently_verified",
      last_resolved_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) return errorResponse(error);

  const aliasRows = aliases.flatMap((rawAlias) => {
    const alias = isRecord(rawAlias)
      ? stringValue(rawAlias.alias) ?? stringValue(rawAlias.name)
      : typeof rawAlias === "string" ? rawAlias : null;
    if (!alias) return [];
    const confidence = isRecord(rawAlias) ? unitOrNull(rawAlias.confidence) : null;
    const confidenceSemantics = isRecord(rawAlias)
      ? stringValue(rawAlias.confidence_semantics) ?? stringValue(rawAlias.confidenceSemantics)
      : null;
    if (confidence !== null && !confidenceSemantics) {
      throw new Error(`Alias ${alias} supplies numeric confidence without confidence semantics`);
    }
    return [{
      entity_id: entity.id,
      alias,
      alias_type: isRecord(rawAlias) ? stringValue(rawAlias.type) ?? "name" : "name",
      source: isRecord(rawAlias) ? stringValue(rawAlias.source) ?? "registration" : "registration",
      confidence,
      confidence_semantics: confidence === null ? "not_quantified" : confidenceSemantics,
      verification_status: "registered_alias_unverified",
    }];
  });
  if (aliasRows.length > 0) await supabase.from("entity_aliases").insert(aliasRows);

  await supabase.from("entity_aliases").upsert({
    entity_id: entity.id,
    alias: name,
    alias_type: "name",
    source: "canonical",
    confidence: null,
    confidence_semantics: "not_applicable_canonical_label_not_identity_probability",
    verification_status: "canonical_label",
  }, { onConflict: "entity_id,alias,alias_type" });

  const extRows = externalIds.flatMap((rawExt) => {
    if (!isRecord(rawExt)) return [];
    const provider = stringValue(rawExt.provider);
    const externalId = stringValue(rawExt.external_id);
    if (!provider || !externalId) return [];
    const verified = rawExt.verified === true;
    const verifiedAt = verified ? isoDateOrNull(rawExt.verified_at) : null;
    const verificationMethod = verified ? stringValue(rawExt.verification_method) : null;
    if (verified && (!verifiedAt || !verificationMethod)) {
      throw new Error(`Verified external identifier ${provider}:${externalId} requires verified_at and verification_method`);
    }
    return [{
      entity_id: entity.id,
      provider,
      external_id: externalId,
      external_type: stringValue(rawExt.external_type),
      last_verified_at: verifiedAt,
      verification_status: verified ? "verified" : "registered_unverified",
      verification_method: verificationMethod,
    }];
  });
  if (extRows.length > 0) await supabase.from("entity_external_ids").insert(extRows);

  structuredLog("info", FN, `${actor} registered entity ${name} (${entityType})`);
  return jsonResponse({
    ok: true,
    entity,
    epistemic_contract: {
      trust_score_issued: false,
      aliases_prove_identity: false,
      external_ids_verified: extRows.filter((row) => row.verification_status === "verified").length,
    },
  });
}

async function linkEntities(
  supabase: ReturnType<typeof createClient>,
  params: RecordValue,
  actor: string,
) {
  const sourceId = stringValue(params.source_id);
  const targetId = stringValue(params.target_id);
  const linkType = stringValue(params.link_type);
  if (!sourceId || !targetId || !linkType) {
    return errorResponse(new Error("source_id, target_id and link_type required"), 400);
  }
  if (sourceId === targetId) return errorResponse(new Error("Cannot link entity to itself"), 400);

  const strength = unitOrNull(params.strength);
  const strengthSemantics = stringValue(params.strength_semantics) ?? stringValue(params.strengthSemantics);
  if (params.strength !== undefined && strength === null) {
    return errorResponse(new Error("strength must be a finite value between 0 and 1"), 400);
  }
  if (strength !== null && !strengthSemantics) {
    return errorResponse(new Error("numeric strength requires strength_semantics"), 400);
  }

  const provenanceConfidence = unitOrNull(params.provenance_confidence);
  const provenanceConfidenceSemantics = stringValue(params.provenance_confidence_semantics);
  if (params.provenance_confidence !== undefined && provenanceConfidence === null) {
    return errorResponse(new Error("provenance_confidence must be between 0 and 1"), 400);
  }
  if (provenanceConfidence !== null && !provenanceConfidenceSemantics) {
    return errorResponse(new Error("numeric provenance_confidence requires provenance_confidence_semantics"), 400);
  }

  const provenanceObservedAt = isoDateOrNull(params.provenance_observed_at);
  if (params.provenance_observed_at !== undefined && provenanceObservedAt === null) {
    return errorResponse(new Error("provenance_observed_at must be a valid ISO datetime"), 400);
  }
  const provenanceTimeSemantics = stringValue(params.provenance_time_semantics);
  if (provenanceObservedAt && !provenanceTimeSemantics) {
    return errorResponse(new Error("provenance_observed_at requires provenance_time_semantics"), 400);
  }

  const verificationStatus = stringValue(params.verification_status) ?? "proposed";
  if (verificationStatus !== "proposed" && verificationStatus !== "verified") {
    return errorResponse(new Error("verification_status must be proposed or verified"), 400);
  }
  const provenanceSource = stringValue(params.provenance_source) ?? stringValue(params.source);
  if (verificationStatus === "verified" && (!provenanceSource || !provenanceObservedAt)) {
    return errorResponse(new Error("verified links require provenance_source and provenance_observed_at"), 400);
  }

  const { data, error } = await supabase
    .from("entity_links")
    .insert({
      source_entity_id: sourceId,
      target_entity_id: targetId,
      link_type: linkType,
      strength,
      strength_semantics: strength === null ? "not_quantified" : strengthSemantics,
      source: stringValue(params.source),
      metadata: isRecord(params.metadata) ? params.metadata : {},
      provenance_source: provenanceSource,
      provenance_confidence: provenanceConfidence,
      provenance_confidence_semantics: provenanceConfidence === null
        ? "not_quantified"
        : provenanceConfidenceSemantics,
      provenance_observed_at: provenanceObservedAt,
      provenance_time_semantics: provenanceObservedAt === null
        ? "source_observation_time_unknown"
        : provenanceTimeSemantics,
      verification_status: verificationStatus,
    })
    .select()
    .single();
  if (error) return errorResponse(error);

  structuredLog("info", FN, `${actor} created ${verificationStatus} entity link ${sourceId} -> ${targetId}`);
  return jsonResponse({ ok: true, link: data });
}

async function mergeEntities(
  supabase: ReturnType<typeof createClient>,
  params: RecordValue,
  actor: string,
) {
  const winnerId = stringValue(params.winner_id);
  const loserId = stringValue(params.loser_id);
  const reason = stringValue(params.reason);
  if (!winnerId || !loserId || !reason) {
    return errorResponse(new Error("winner_id, loser_id and reason required"), 400);
  }
  if (params.confirm_merge !== true) {
    return errorResponse(new Error("confirm_merge=true is required for destructive identity merge"), 400);
  }

  const confidence = unitOrNull(params.confidence);
  if (params.confidence !== undefined && confidence === null) {
    return errorResponse(new Error("confidence must be between 0 and 1 when supplied"), 400);
  }

  const { data, error } = await supabase.rpc("merge_entities_tx", {
    _winner_id: winnerId,
    _loser_id: loserId,
    _reason: reason,
    _confidence: confidence,
    _merged_by: actor,
  });
  if (error) return errorResponse(error);

  structuredLog("info", FN, `${actor} explicitly merged entity ${loserId} -> ${winnerId}`);
  return jsonResponse({
    ...((isRecord(data) ? data : { result: data }) as RecordValue),
    merge_decision_semantics: "explicit_privileged_identity_merge_not_similarity_autopromotion",
  });
}

async function searchEntities(supabase: ReturnType<typeof createClient>, params: RecordValue) {
  const query = stringValue(params.query);
  const entityType = stringValue(params.entity_type);
  const iso3 = stringValue(params.iso3);
  const limit = integerInRange(params.limit, 1, 100) ?? 20;
  if (!query) return errorResponse(new Error("query required"), 400);

  const { data: ranked } = await supabase.rpc("similarity_search_entities", {
    search_name: query,
    search_type: entityType,
    min_similarity: 0.2,
    max_results: limit,
  });

  const results: RecordValue[] = (ranked ?? []).map((row: RecordValue) => ({
    ...row,
    match_score: unitOrNull(row.similarity),
    match_score_semantics: "trigram_string_similarity_not_identity_probability",
  }));

  if (results.length < 3) {
    let dbQuery = supabase
      .from("canonical_entities")
      .select("*")
      .ilike("canonical_name", `%${query}%`)
      .limit(limit);
    if (entityType) dbQuery = dbQuery.eq("entity_type", entityType);
    if (iso3) dbQuery = dbQuery.eq("iso3", iso3);
    const { data: substringHits } = await dbQuery;

    const seen = new Set(results.map((row) => stringValue(row.id)).filter(Boolean));
    for (const hit of substringHits ?? []) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      results.push({
        ...(hit as RecordValue),
        match_source: "substring",
        match_score: null,
        match_score_semantics: "substring_candidate_not_numeric_identity_score",
      });
    }
  }

  return jsonResponse({
    results,
    count: results.length,
    result_semantics: "search_candidates_not_resolved_identities",
  });
}

async function getEntityGraph(supabase: ReturnType<typeof createClient>, params: RecordValue) {
  const entityId = stringValue(params.entity_id);
  const depth = integerInRange(params.depth, 1, 5) ?? 1;
  if (!entityId) return errorResponse(new Error("entity_id required"), 400);

  const { data: entity } = await supabase
    .from("canonical_entities")
    .select("*")
    .eq("id", entityId)
    .single();
  if (!entity) return errorResponse(new Error("Entity not found"), 404);

  const [aliasRes, extRes, graphRes] = await Promise.all([
    supabase.from("entity_aliases").select("*").eq("entity_id", entityId),
    supabase.from("entity_external_ids").select("*").eq("entity_id", entityId),
    supabase.rpc("traverse_entity_graph", { _entity_id: entityId, _depth: depth }),
  ]);

  const edges = graphRes.data ?? [];
  return jsonResponse({
    entity,
    aliases: aliasRes.data ?? [],
    external_ids: extRes.data ?? [],
    relationships: {
      outgoing: edges.filter((edge: RecordValue) => edge.direction === "outgoing"),
      incoming: edges.filter((edge: RecordValue) => edge.direction === "incoming"),
    },
    graph_depth: depth,
    total_connections: edges.length,
  });
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unitOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function isoDateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function integerInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}
