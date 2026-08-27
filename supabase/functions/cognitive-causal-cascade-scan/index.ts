import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-causal-cascade-scan";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CAUSAL_SCORE_SEMANTICS = "deterministic_causal_evidence_screen_score_v2_not_probability";
const CONFIDENCE_SEMANTICS = "not_calibrated_no_causal_probability_issued";
const TEMPORAL_SEMANTICS = "not_assessed_no_cause_effect_event_pair_mapping";
const SOURCE_INDEPENDENCE_STATUS = "not_assessed_distinct_source_identifiers_only";
const SYSTEMIC_SCORE_SEMANTICS = "deterministic_systemic_priority_heuristic_v2_not_probability";
const STRUCTURAL_SCORE_SEMANTICS = "product_of_explicit_relationship_strength_and_explicit_relationship_confidence_v2";
const CAUSAL_PATH_SCORE_SEMANTICS = "product_of_deterministic_causal_evidence_screen_scores_v2_not_probability";
const SUPPORT_SEMANTICS = "automated_scan_candidate_only_manual_or_governed_promotion_required";

type Relationship = {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: number | null;
  confidence: number | null;
  confidence_semantics: string | null;
};

type Claim = {
  id: string;
  epistemic_status: string;
  confidence: number | null;
  confidence_semantics: string | null;
  occurred_at: string | null;
  valid_from: string | null;
  source_id: string;
  source_type: string;
  metadata: Record<string, unknown> | null;
};

type RelationshipEvidence = {
  relationship_id: string;
  claim_id: string;
  stance: "supports" | "contradicts" | "context";
  weight: number | null;
  weight_semantics: string | null;
};

type EvidenceScore = {
  score: number | null;
  claimCount: number;
  quantifiedCount: number;
  unquantifiedCount: number;
};

type Assessment = {
  verdict: string;
  causal_score: number | null;
  confidence: null;
  temporal_precedence: null;
  mechanism_support: number | null;
  evidence_diversity: number | null;
  contradiction_penalty: number | null;
  confounder_penalty: number | null;
  intervention_support: number | null;
  counterfactual_support: number | null;
  supporting_claim_ids: string[];
  contradicting_claim_ids: string[];
  mechanism_claim_ids: string[];
  confounder_claim_ids: string[];
  reasons: string[];
  score_semantics: string;
  confidence_semantics: string;
  temporal_precedence_semantics: string;
  source_independence_status: string;
  quantitative_evidence_status: string;
  eligible_for_cascade: boolean;
};

type CascadeStepCandidate = {
  relationship: Relationship;
  structural_score: number;
  cumulative_structural_score: number;
  causal_evidence_score: number;
  cumulative_causal_evidence_score: number;
};

type CascadeCandidate = {
  node_ids: string[];
  steps: CascadeStepCandidate[];
  hops: number;
  structural_score: number;
  causal_evidence_score: number;
  weakest_causal_score: number;
  systemic_score: number;
};

type TraverseFrame = {
  current: string;
  nodeIds: string[];
  steps: CascadeStepCandidate[];
  structuralScore: number;
  causalEvidenceScore: number;
  weakestCausalScore: number;
  strengthSum: number;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });

  const { user, via, response } = await requireAdminOrCron(req, corsHeaders);
  if (response) return response;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const maxRelationshipsResult = integerOption(body.max_relationships, 1000, 1, 5000, "max_relationships");
  if (!maxRelationshipsResult.ok) return json({ error: maxRelationshipsResult.error }, 400);
  const maxCascadeHopsResult = integerOption(body.max_cascade_hops, 5, 2, 8, "max_cascade_hops");
  if (!maxCascadeHopsResult.ok) return json({ error: maxCascadeHopsResult.error }, 400);
  const minCausalScoreResult = unitIntervalOption(body.min_causal_score, 0.55, "min_causal_score");
  if (!minCausalScoreResult.ok) return json({ error: minCausalScoreResult.error }, 400);

  const maxRelationships = maxRelationshipsResult.value;
  const maxCascadeHops = maxCascadeHopsResult.value;
  const minCausalScore = minCausalScoreResult.value;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: relationships, error: relationshipError } = await supabase
    .from("aicis_world_relationships")
    .select("id,source_entity_id,target_entity_id,relationship_type,strength,confidence,confidence_semantics")
    .eq("status", "verified")
    .not("epistemic_status", "in", '("unverified","contradicted")')
    .order("updated_at", { ascending: false })
    .limit(maxRelationships);

  if (relationshipError) return json({ error: "Failed to load verified relationships" }, 500);
  const edges = (relationships ?? []) as Relationship[];
  if (edges.length === 0) {
    return json({
      success: true,
      relationships_scanned: 0,
      cascades_persisted: 0,
      auto_supported_cascades: 0,
      causal_score_semantics: CAUSAL_SCORE_SEMANTICS,
      auto_promotion_performed: false,
    });
  }

  const relationshipIds = edges.map((edge) => edge.id);
  const { data: links, error: linkError } = await supabase
    .from("aicis_relationship_evidence")
    .select("relationship_id,claim_id,stance,weight,weight_semantics")
    .in("relationship_id", relationshipIds);
  if (linkError) return json({ error: "Failed to load relationship evidence" }, 500);

  const evidenceLinks = (links ?? []) as RelationshipEvidence[];
  const claimIds = [...new Set(evidenceLinks.map((link) => link.claim_id))];
  const claims: Claim[] = [];
  if (claimIds.length > 0) {
    for (const chunk of chunkArray(claimIds, 400)) {
      const { data, error } = await supabase
        .from("aicis_evidence_claims")
        .select("id,epistemic_status,confidence,confidence_semantics,occurred_at,valid_from,source_id,source_type,metadata")
        .in("id", chunk);
      if (error) return json({ error: "Failed to load evidence claims" }, 500);
      claims.push(...((data ?? []) as Claim[]));
    }
  }

  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const linksByRelationship = new Map<string, RelationshipEvidence[]>();
  for (const link of evidenceLinks) push(linksByRelationship, link.relationship_id, link);

  const assessmentByRelationship = new Map<string, Assessment>();
  let mechanisticallySupported = 0;
  let eligibleRelationships = 0;
  let quantitativeAbstentions = 0;

  for (const relationship of edges) {
    const relatedLinks = linksByRelationship.get(relationship.id) ?? [];
    const assessment = assess(relationship, relatedLinks, claimById, minCausalScore);
    assessmentByRelationship.set(relationship.id, assessment);

    if (assessment.verdict === "mechanistically-supported") mechanisticallySupported += 1;
    if (assessment.eligible_for_cascade) eligibleRelationships += 1;
    if (assessment.causal_score === null) quantitativeAbstentions += 1;

    const { error } = await supabase.from("aicis_causal_assessments").insert({
      relationship_id: relationship.id,
      ...assessment,
      method: "aicis-evidence-causal-screen-v2",
      metadata: {
        scanner: FN,
        auth_via: via,
        relationship_confidence: relationship.confidence,
        relationship_confidence_semantics: relationship.confidence_semantics,
        relationship_strength: relationship.strength,
        automatic_causal_truth_promotion: false,
      },
    });
    if (error) {
      console.error(JSON.stringify({
        level: "warn",
        function: FN,
        message: "assessment_insert_failed",
        relationship_id: relationship.id,
        error: error.message,
      }));
    }
  }

  const cascadeEdges = edges.filter((edge) => {
    const assessment = assessmentByRelationship.get(edge.id);
    return Boolean(
      assessment?.eligible_for_cascade &&
      assessment.causal_score !== null &&
      assessment.causal_score >= minCausalScore &&
      hasExplicitStructuralInputs(edge)
    );
  });

  const { data: latestSnapshot } = await supabase
    .from("aicis_graph_snapshots")
    .select("id,captured_at")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const adjacency = new Map<string, Relationship[]>();
  for (const edge of cascadeEdges) push(adjacency, edge.source_entity_id, edge);

  const cascadeCandidates = detectCascades(
    cascadeEdges,
    adjacency,
    assessmentByRelationship,
    maxCascadeHops,
  )
    .filter((candidate) => candidate.hops >= 2 && candidate.systemic_score >= 0.45)
    .sort((a, b) => b.systemic_score - a.systemic_score)
    .slice(0, 100);

  let cascadesPersisted = 0;
  let preexistingSupportedPreserved = 0;
  for (const candidate of cascadeCandidates) {
    const cascadeKey = await sha256Hex(candidate.node_ids.join("→"));
    let existingStatus: string | null = null;
    let existingId: string | null = null;

    if (latestSnapshot?.id) {
      const { data: existing } = await supabase
        .from("aicis_cascades")
        .select("id,status")
        .eq("cascade_key", cascadeKey)
        .eq("graph_snapshot_id", latestSnapshot.id)
        .maybeSingle();
      existingStatus = existing?.status ?? null;
      existingId = existing?.id ?? null;
    }

    const persistedStatus = existingStatus === "supported" ? "supported" : "candidate";
    if (existingStatus === "supported") preexistingSupportedPreserved += 1;
    const supportSemantics = existingStatus === "supported"
      ? "preexisting_supported_status_preserved_not_revalidated_by_truth_floor_v2"
      : SUPPORT_SEMANTICS;

    const cascadePayload = {
      cascade_key: cascadeKey,
      origin_entity_id: candidate.node_ids[0],
      terminal_entity_id: candidate.node_ids[candidate.node_ids.length - 1],
      status: persistedStatus,
      epistemic_status: "derived",
      systemic_score: candidate.systemic_score,
      systemic_score_semantics: SYSTEMIC_SCORE_SEMANTICS,
      structural_confidence: candidate.structural_score,
      structural_confidence_semantics: STRUCTURAL_SCORE_SEMANTICS,
      causal_confidence: null,
      causal_confidence_semantics: CONFIDENCE_SEMANTICS,
      causal_evidence_score: candidate.causal_evidence_score,
      causal_evidence_score_semantics: CAUSAL_PATH_SCORE_SEMANTICS,
      support_semantics: supportSemantics,
      hop_count: candidate.hops,
      cross_domain_count: 0,
      last_detected_at: new Date().toISOString(),
      graph_snapshot_id: latestSnapshot?.id ?? null,
      provenance: latestSnapshot ? [{
        sourceId: `graph-snapshot:${latestSnapshot.id}`,
        sourceType: "derived-verified-graph",
        observedAt: latestSnapshot.captured_at,
        extractor: FN,
        extractorVersion: "2",
      }] : [],
      metadata: {
        node_ids: candidate.node_ids,
        weakest_causal_score: candidate.weakest_causal_score,
        causal_score_semantics: CAUSAL_SCORE_SEMANTICS,
        systemic_score_semantics: SYSTEMIC_SCORE_SEMANTICS,
        source_independence_status: SOURCE_INDEPENDENCE_STATUS,
        note: "Automated cascade detection is a structurally and evidentially screened candidate. It is not automated proof of causation and is not auto-promoted to supported.",
      },
    };

    let cascadeId = existingId;
    if (existingId) {
      const { error } = await supabase.from("aicis_cascades").update(cascadePayload).eq("id", existingId);
      if (error) continue;
    } else {
      const { data: cascade, error } = await supabase
        .from("aicis_cascades")
        .insert(cascadePayload)
        .select("id")
        .single();
      if (error || !cascade) continue;
      cascadeId = cascade.id;
    }
    if (!cascadeId) continue;
    cascadesPersisted += 1;

    await supabase.from("aicis_cascade_steps").delete().eq("cascade_id", cascadeId);
    const stepRows = candidate.steps.map((step, index) => ({
      cascade_id: cascadeId,
      step_index: index,
      relationship_id: step.relationship.id,
      source_entity_id: step.relationship.source_entity_id,
      target_entity_id: step.relationship.target_entity_id,
      structural_confidence: step.structural_score,
      cumulative_confidence: step.cumulative_structural_score,
      structural_score_semantics: STRUCTURAL_SCORE_SEMANTICS,
      cumulative_score_semantics: `${STRUCTURAL_SCORE_SEMANTICS}; multiplicative_path_accumulation`,
      causal_evidence_score: step.cumulative_causal_evidence_score,
      causal_evidence_score_semantics: CAUSAL_PATH_SCORE_SEMANTICS,
    }));
    if (stepRows.length > 0) await supabase.from("aicis_cascade_steps").insert(stepRows);

    if (persistedStatus === "candidate" && candidate.systemic_score >= 0.65) {
      const detectedAt = new Date().toISOString();
      await supabase.from("aicis_cognitive_events").insert({
        event_type: "cascade.detected",
        epistemic_status: "derived",
        confidence: null,
        confidence_semantics: "not_calibrated_candidate_detection",
        subject_entity_id: candidate.node_ids[0],
        occurred_at: detectedAt,
        observed_at: detectedAt,
        time_semantics: "system_detection_time_not_underlying_cascade_event_time",
        producer: FN,
        payload: {
          cascade_id: cascadeId,
          status: "candidate",
          node_ids: candidate.node_ids,
          hops: candidate.hops,
          systemic_score: candidate.systemic_score,
          systemic_score_semantics: SYSTEMIC_SCORE_SEMANTICS,
          causal_evidence_score: candidate.causal_evidence_score,
          causal_evidence_score_semantics: CAUSAL_PATH_SCORE_SEMANTICS,
          weakest_causal_score: candidate.weakest_causal_score,
          automatic_causal_truth_promotion: false,
        },
        provenance: latestSnapshot ? [{
          sourceId: `graph-snapshot:${latestSnapshot.id}`,
          sourceType: "derived-verified-graph",
          observedAt: latestSnapshot.captured_at,
          extractor: FN,
          extractorVersion: "2",
        }] : [],
      });
    }
  }

  await supabase.from("system_logs").insert({
    action: "cognitive_causal_cascade_scan",
    user_id: user?.id ?? null,
    log_level: "info",
    result: `Screened ${edges.length} relationships and persisted ${cascadesPersisted} cascade candidates`,
    metadata: {
      auth_via: via,
      relationships_scanned: edges.length,
      mechanistically_supported_screen: mechanisticallySupported,
      cascade_eligible_relationships: eligibleRelationships,
      quantitative_abstentions: quantitativeAbstentions,
      cascade_edges: cascadeEdges.length,
      cascades_persisted: cascadesPersisted,
      auto_supported_cascades: 0,
      preexisting_supported_preserved: preexistingSupportedPreserved,
      automatic_causal_truth_promotion: false,
      causal_score_semantics: CAUSAL_SCORE_SEMANTICS,
      source_independence_status: SOURCE_INDEPENDENCE_STATUS,
    },
  });

  return json({
    success: true,
    relationships_scanned: edges.length,
    mechanistically_supported_screen: mechanisticallySupported,
    cascade_eligible_relationships: eligibleRelationships,
    quantitative_abstentions: quantitativeAbstentions,
    cascade_edges: cascadeEdges.length,
    cascades_persisted: cascadesPersisted,
    auto_supported_cascades: 0,
    preexisting_supported_preserved: preexistingSupportedPreserved,
    automatic_causal_truth_promotion: false,
    causal_score_semantics: CAUSAL_SCORE_SEMANTICS,
    systemic_score_semantics: SYSTEMIC_SCORE_SEMANTICS,
    source_independence_status: SOURCE_INDEPENDENCE_STATUS,
  });
});

function assess(
  relationship: Relationship,
  links: RelationshipEvidence[],
  claimById: Map<string, Claim>,
  minCausalScore: number,
): Assessment {
  const supports = linkedClaims(links, "supports", claimById);
  const contradicts = linkedClaims(links, "contradicts", claimById);
  const context = linkedClaims(links, "context", claimById);

  const mechanisms = supports.filter((claim) => role(claim) === "mechanism");
  const interventions = supports.filter((claim) => role(claim) === "intervention");
  const counterfactuals = supports.filter((claim) => role(claim) === "counterfactual");
  const confounders = context.filter((claim) => role(claim) === "confounder");

  const baseSupport = evidenceSupportScore(supports);
  const mechanismSupport = evidenceSupportScore(mechanisms);
  const interventionSupport = evidenceSupportScore(interventions);
  const counterfactualSupport = evidenceSupportScore(counterfactuals);
  const contradictionPenalty = evidenceSupportScore(contradicts);
  const confounderPenalty = evidenceSupportScore(confounders);
  const evidenceDiversity = supports.length > 0 ? sourceIdentifierDiversity(supports) : 0;

  const allRelevantClaims = [...supports, ...contradicts, ...context];
  const quantifiedRelevant = allRelevantClaims.filter(hasExplicitClaimConfidence).length;
  const unquantifiedRelevant = allRelevantClaims.length - quantifiedRelevant;
  const quantitativeEvidenceStatus = allRelevantClaims.length === 0
    ? "no_attached_evidence"
    : unquantifiedRelevant === 0
      ? "complete_for_attached_evidence"
      : quantifiedRelevant === 0
        ? "attached_evidence_unquantified"
        : "partial_quantitative_coverage";

  const requiredScores = [
    baseSupport.score,
    contradictionPenalty.score,
    confounderPenalty.score,
  ];
  const canCompute = supports.length > 0 && requiredScores.every((score) => score !== null);

  const causalScore = canCompute
    ? heuristicCausalEvidenceScore({
      baseSupport: Number(baseSupport.score),
      evidenceDiversity,
      mechanismSupport: numericOrZeroWhenNoClaims(mechanismSupport),
      interventionSupport: numericOrZeroWhenNoClaims(interventionSupport),
      counterfactualSupport: numericOrZeroWhenNoClaims(counterfactualSupport),
      contradictionPenalty: Number(contradictionPenalty.score),
      confounderPenalty: Number(confounderPenalty.score),
    })
    : null;

  let verdict = "insufficient-evidence";
  if (causalScore !== null && contradictionPenalty.score !== null && contradictionPenalty.score >= 0.75 && causalScore < 0.35) {
    verdict = "contradicted";
  } else if (causalScore === null || supports.length < 2) {
    verdict = "insufficient-evidence";
  } else if (causalScore < 0.45) {
    verdict = "associated";
  } else if (mechanismSupport.score !== null && mechanismSupport.score >= 0.55 && causalScore >= 0.55) {
    verdict = "mechanistically-supported";
  } else {
    verdict = "associated";
  }

  const structuralInputsExplicit = hasExplicitStructuralInputs(relationship);
  const eligibleForCascade = verdict === "mechanistically-supported" &&
    causalScore !== null &&
    causalScore >= minCausalScore &&
    quantitativeEvidenceStatus === "complete_for_attached_evidence" &&
    structuralInputsExplicit;

  const reasons: string[] = [];
  if (supports.length === 0) reasons.push("No supporting evidence claims are attached");
  if (supports.length > 0 && baseSupport.score === null) reasons.push("Supporting evidence exists but its numeric confidence is unquantified or legacy-unverified; numeric causal screening abstained");
  if (unquantifiedRelevant > 0) reasons.push(`${unquantifiedRelevant} attached evidence claim(s) were not treated as numeric confidence`);
  if (mechanisms.length > 0 && mechanismSupport.score !== null) reasons.push("Mechanism-labeled evidence contributes to the deterministic evidence screen");
  if (contradicts.length > 0) reasons.push("Contradictory evidence is attached and retained in the assessment");
  if (confounders.length > 0) reasons.push("Confounder-labeled context is attached and retained in the assessment");
  if (!structuralInputsExplicit) reasons.push("Relationship strength/confidence is incomplete or legacy-unverified; cascade propagation is withheld");
  reasons.push("Temporal precedence is not inferred from the mere presence of timestamps; a mapped cause/effect event assessment is required separately");
  reasons.push("Distinct source identifiers are not proof of source independence; source independence remains unassessed");
  reasons.push("Automated screening never emits the causally-supported verdict in truth-floor-v2");

  return {
    verdict,
    causal_score: causalScore,
    confidence: null,
    temporal_precedence: null,
    mechanism_support: mechanismSupport.score,
    evidence_diversity: evidenceDiversity,
    contradiction_penalty: contradictionPenalty.score,
    confounder_penalty: confounderPenalty.score,
    intervention_support: interventionSupport.score,
    counterfactual_support: counterfactualSupport.score,
    supporting_claim_ids: supports.map((claim) => claim.id),
    contradicting_claim_ids: contradicts.map((claim) => claim.id),
    mechanism_claim_ids: mechanisms.map((claim) => claim.id),
    confounder_claim_ids: confounders.map((claim) => claim.id),
    reasons,
    score_semantics: CAUSAL_SCORE_SEMANTICS,
    confidence_semantics: CONFIDENCE_SEMANTICS,
    temporal_precedence_semantics: TEMPORAL_SEMANTICS,
    source_independence_status: SOURCE_INDEPENDENCE_STATUS,
    quantitative_evidence_status: quantitativeEvidenceStatus,
    eligible_for_cascade: eligibleForCascade,
  };
}

function linkedClaims(
  links: RelationshipEvidence[],
  stance: RelationshipEvidence["stance"],
  claimById: Map<string, Claim>,
): Claim[] {
  return links
    .filter((link) => link.stance === stance)
    .map((link) => claimById.get(link.claim_id))
    .filter((claim): claim is Claim => Boolean(claim));
}

function evidenceSupportScore(claims: Claim[]): EvidenceScore {
  if (claims.length === 0) {
    return { score: 0, claimCount: 0, quantifiedCount: 0, unquantifiedCount: 0 };
  }
  const quantified = claims.filter(hasExplicitClaimConfidence);
  if (quantified.length === 0) {
    return {
      score: null,
      claimCount: claims.length,
      quantifiedCount: 0,
      unquantifiedCount: claims.length,
    };
  }
  const score = quantified.reduce((sum, claim) => sum + Number(claim.confidence), 0) / quantified.length;
  return {
    score: clamp01(score),
    claimCount: claims.length,
    quantifiedCount: quantified.length,
    unquantifiedCount: claims.length - quantified.length,
  };
}

function heuristicCausalEvidenceScore(input: {
  baseSupport: number;
  evidenceDiversity: number;
  mechanismSupport: number;
  interventionSupport: number;
  counterfactualSupport: number;
  contradictionPenalty: number;
  confounderPenalty: number;
}) {
  return clamp01(
    0.28 * input.baseSupport +
    0.15 * input.evidenceDiversity +
    0.20 * input.mechanismSupport +
    0.14 * input.interventionSupport +
    0.13 * input.counterfactualSupport -
    0.15 * input.contradictionPenalty -
    0.10 * input.confounderPenalty,
  );
}

function numericOrZeroWhenNoClaims(score: EvidenceScore): number {
  if (score.claimCount === 0) return 0;
  return score.score ?? 0;
}

function sourceIdentifierDiversity(claims: Claim[]): number {
  if (claims.length === 0) return 0;
  const ids = new Set(claims.map((claim) => claim.source_id.toLowerCase()));
  const types = new Set(claims.map((claim) => claim.source_type.toLowerCase()));
  return clamp01(0.7 * Math.min(1, ids.size / 4) + 0.3 * Math.min(1, types.size / 3));
}

function hasExplicitClaimConfidence(claim: Claim) {
  return isUnitInterval(claim.confidence) && hasUsableNumericSemantics(claim.confidence_semantics);
}

function hasExplicitStructuralInputs(relationship: Relationship) {
  return isUnitInterval(relationship.strength) &&
    isUnitInterval(relationship.confidence) &&
    hasUsableNumericSemantics(relationship.confidence_semantics);
}

function hasUsableNumericSemantics(semantics: string | null) {
  if (!semantics) return false;
  const normalized = semantics.toLowerCase();
  return !normalized.includes("legacy") &&
    !normalized.includes("unknown") &&
    !normalized.includes("not_quantified") &&
    !normalized.includes("unverified");
}

function detectCascades(
  edges: Relationship[],
  adjacency: Map<string, Relationship[]>,
  assessments: Map<string, Assessment>,
  maxHops: number,
): CascadeCandidate[] {
  const results: CascadeCandidate[] = [];
  const origins = [...new Set(edges.map((edge) => edge.source_entity_id))];

  for (const origin of origins) {
    const stack: TraverseFrame[] = [{
      current: origin,
      nodeIds: [origin],
      steps: [],
      structuralScore: 1,
      causalEvidenceScore: 1,
      weakestCausalScore: 1,
      strengthSum: 0,
    }];

    while (stack.length > 0 && results.length < 500) {
      const frame = stack.pop();
      if (!frame || frame.steps.length >= maxHops) continue;

      for (const edge of adjacency.get(frame.current) ?? []) {
        if (frame.nodeIds.includes(edge.target_entity_id)) continue;
        if (!hasExplicitStructuralInputs(edge)) continue;
        const assessment = assessments.get(edge.id);
        if (!assessment?.eligible_for_cascade || assessment.causal_score === null) continue;

        const relationshipStrength = Number(edge.strength);
        const relationshipConfidence = Number(edge.confidence);
        const edgeStructural = clamp01(relationshipStrength * relationshipConfidence);
        const structuralScore = frame.structuralScore * edgeStructural;
        const edgeCausalEvidence = assessment.causal_score;
        const causalEvidenceScore = frame.causalEvidenceScore * edgeCausalEvidence;
        const weakestCausalScore = Math.min(frame.weakestCausalScore, edgeCausalEvidence);
        if (structuralScore < 0.08 || causalEvidenceScore < 0.08) continue;

        const steps: CascadeStepCandidate[] = [...frame.steps, {
          relationship: edge,
          structural_score: edgeStructural,
          cumulative_structural_score: structuralScore,
          causal_evidence_score: edgeCausalEvidence,
          cumulative_causal_evidence_score: causalEvidenceScore,
        }];
        const nodeIds = [...frame.nodeIds, edge.target_entity_id];
        const strengthSum = frame.strengthSum + relationshipStrength;
        const avgStrength = strengthSum / steps.length;
        const systemicScore = clamp01(
          0.35 * structuralScore +
          0.25 * causalEvidenceScore +
          0.20 * avgStrength +
          0.20 * clamp01(steps.length / maxHops),
        );

        results.push({
          node_ids: nodeIds,
          steps,
          hops: steps.length,
          structural_score: structuralScore,
          causal_evidence_score: causalEvidenceScore,
          weakest_causal_score: weakestCausalScore,
          systemic_score: systemicScore,
        });
        stack.push({
          current: edge.target_entity_id,
          nodeIds,
          steps,
          structuralScore,
          causalEvidenceScore,
          weakestCausalScore,
          strengthSum,
        });
      }
    }
  }
  return results;
}

function role(claim: Claim): string {
  return String(claim.metadata?.evidence_role ?? claim.metadata?.role ?? "").toLowerCase();
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

function integerOption(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return { ok: false, error: `${name} must be an integer from ${min} through ${max}` };
  }
  return { ok: true, value };
}

function unitIntervalOption(
  value: unknown,
  fallback: number,
  name: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: fallback };
  if (!isUnitInterval(value)) return { ok: false, error: `${name} must be a finite number between 0 and 1` };
  return { ok: true, value };
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
