import type {
  CognitiveEvent,
  EvidenceClaim,
  WorldEntity,
  WorldRelationship,
} from "./contracts";
import { assessExtraction, mentionsLikelyMatch, type ExtractionCandidate } from "./perception";

export interface EntityMention {
  text: string;
  hintedType?: string;
  externalIds?: Record<string, string>;
}

export interface EntityResolutionCandidate {
  entity: WorldEntity;
  score: number;
  scoreSemantics: string;
  autoResolvable: boolean;
  reasons: string[];
}

export interface PerceptionPipelineInput {
  candidate: ExtractionCandidate;
  subjectMention?: EntityMention;
  objectMention?: EntityMention;
  knownEntities: WorldEntity[];
  occurredAt?: string | null;
  timeSemantics?: string;
  producer: string;
}

export interface PerceptionPipelineResult {
  assessment: ReturnType<typeof assessExtraction>;
  subjectResolution?: EntityResolutionCandidate;
  objectResolution?: EntityResolutionCandidate;
  claimDraft: Omit<EvidenceClaim, "id">;
  relationshipDraft?: Omit<WorldRelationship, "id">;
  events: CognitiveEvent[];
}

/**
 * Deterministic pre-knowledge pipeline. NLP output becomes auditable drafts, not
 * verified graph state. Observation time is never substituted for unknown event
 * occurrence time, and extractor scores never become epistemic confidence.
 */
export function buildPerceptionArtifacts(
  input: PerceptionPipelineInput,
): PerceptionPipelineResult {
  const assessment = assessExtraction(input.candidate);
  const subjectResolution = input.candidate.subjectEntityId
    ? exactEntityResolution(input.candidate.subjectEntityId, input.knownEntities)
    : resolveEntityMention(input.subjectMention, input.knownEntities);
  const objectResolution = input.candidate.objectEntityId
    ? exactEntityResolution(input.candidate.objectEntityId, input.knownEntities)
    : resolveEntityMention(input.objectMention, input.knownEntities);

  const observedAt = newestObservedAt(input.candidate.provenance);
  const occurredAt = input.occurredAt ?? null;
  const timeSemantics = occurredAt === null
    ? input.timeSemantics ?? "occurrence_time_unknown_observation_time_not_substituted"
    : input.timeSemantics ?? "caller_supplied_occurrence_time_semantics_unspecified";

  const subjectEntityId = subjectResolution?.autoResolvable
    ? subjectResolution.entity.id
    : input.candidate.subjectEntityId;
  const objectEntityId = objectResolution?.autoResolvable
    ? objectResolution.entity.id
    : input.candidate.objectEntityId;

  const claimDraft: Omit<EvidenceClaim, "id"> = {
    statement: input.candidate.statement,
    subjectEntityId,
    predicate: input.candidate.predicate,
    objectEntityId,
    objectValue: input.candidate.objectValue,
    epistemicStatus: assessment.epistemicStatus,
    confidence: null,
    confidenceSemantics: assessment.confidenceSemantics,
    occurredAt,
    timeSemantics,
    provenance: input.candidate.provenance,
    metadata: {
      ...(input.candidate.metadata ?? {}),
      perception: {
        distinctSourceIdentifiers: assessment.distinctSourceIdentifiers,
        sourceTypes: assessment.sourceTypes,
        sourceIndependenceStatus: assessment.sourceIndependenceStatus,
        hasDirectObservation: assessment.hasDirectObservation,
        extractorConfidence: assessment.extractorConfidence,
        extractorConfidenceSemantics: assessment.extractorConfidenceSemantics,
        reasons: assessment.reasons,
        subjectResolutionScore: subjectResolution?.score ?? null,
        subjectResolutionScoreSemantics: subjectResolution?.scoreSemantics ?? null,
        subjectAutoResolvable: subjectResolution?.autoResolvable ?? false,
        objectResolutionScore: objectResolution?.score ?? null,
        objectResolutionScoreSemantics: objectResolution?.scoreSemantics ?? null,
        objectAutoResolvable: objectResolution?.autoResolvable ?? false,
      },
    },
  };

  const events: CognitiveEvent[] = [
    {
      eventType: "claim.extracted",
      epistemicStatus: assessment.epistemicStatus,
      confidence: null,
      confidenceSemantics: assessment.confidenceSemantics,
      subjectEntityId,
      occurredAt,
      observedAt,
      timeSemantics,
      producer: input.producer,
      payload: {
        statement: input.candidate.statement,
        predicate: input.candidate.predicate ?? null,
        objectEntityId: objectEntityId ?? null,
        distinctSourceIdentifiers: assessment.distinctSourceIdentifiers,
        sourceIndependenceStatus: assessment.sourceIndependenceStatus,
        extractorConfidence: assessment.extractorConfidence,
        extractorConfidenceSemantics: assessment.extractorConfidenceSemantics,
        assessmentReasons: assessment.reasons,
      },
      provenance: input.candidate.provenance,
    },
  ];

  if (subjectResolution?.autoResolvable) {
    events.push(entityResolvedEvent(subjectResolution, input.producer, observedAt, input.candidate));
  }
  if (objectResolution?.autoResolvable && objectResolution.entity.id !== subjectResolution?.entity.id) {
    events.push(entityResolvedEvent(objectResolution, input.producer, observedAt, input.candidate));
  }

  let relationshipDraft: Omit<WorldRelationship, "id"> | undefined;
  if (
    subjectEntityId &&
    objectEntityId &&
    subjectEntityId !== objectEntityId &&
    input.candidate.predicate
  ) {
    relationshipDraft = {
      sourceEntityId: subjectEntityId,
      targetEntityId: objectEntityId,
      relationshipType: input.candidate.predicate,
      status: "proposed",
      epistemicStatus: assessment.epistemicStatus,
      strength: null,
      strengthSemantics: "unknown_not_quantified_perception_relationship",
      confidence: null,
      confidenceSemantics: "unknown_not_quantified_perception_relationship",
      ...(occurredAt ? { validFrom: occurredAt } : {}),
      evidenceClaimIds: [],
      metadata: {
        generatedBy: "perception-pipeline",
        promotionRequired: true,
        sourceIndependenceStatus: assessment.sourceIndependenceStatus,
        note: "Claim extraction does not establish relationship strength, relationship confidence, or identity beyond explicitly auto-resolved entities.",
      },
    };

    events.push({
      eventType: "relationship.proposed",
      epistemicStatus: assessment.epistemicStatus,
      confidence: null,
      confidenceSemantics: "unknown_not_quantified_relationship_proposal",
      subjectEntityId,
      occurredAt,
      observedAt,
      timeSemantics,
      producer: input.producer,
      payload: {
        sourceEntityId: subjectEntityId,
        targetEntityId: objectEntityId,
        relationshipType: input.candidate.predicate,
        promotionRequired: true,
        strength: null,
        relationshipConfidence: null,
      },
      provenance: input.candidate.provenance,
    });
  }

  return {
    assessment,
    subjectResolution,
    objectResolution,
    claimDraft,
    relationshipDraft,
    events,
  };
}

/**
 * Candidate resolver for canonical identity. Name similarity alone never receives
 * auto-resolution authority. Only an explicit known entity id or matching external
 * identifier crosses the automatic identity boundary.
 */
export function resolveEntityMention(
  mention: EntityMention | undefined,
  entities: WorldEntity[],
): EntityResolutionCandidate | undefined {
  if (!mention?.text.trim()) return undefined;

  const candidates: EntityResolutionCandidate[] = [];
  for (const entity of entities) {
    let score = 0;
    let scoreSemantics = "deterministic_name_similarity_candidate_score";
    let autoResolvable = false;
    const reasons: string[] = [];

    if (entity.canonicalName.trim().toLocaleLowerCase() === mention.text.trim().toLocaleLowerCase()) {
      score = 0.95;
      reasons.push("Exact canonical-name match; identity still requires disambiguation");
    } else if (entity.aliases.some((alias) => alias.trim().toLocaleLowerCase() === mention.text.trim().toLocaleLowerCase())) {
      score = 0.94;
      reasons.push("Exact alias match; identity still requires disambiguation");
    } else if (
      mentionsLikelyMatch(entity.canonicalName, mention.text) ||
      entity.aliases.some((alias) => mentionsLikelyMatch(alias, mention.text))
    ) {
      score = 0.82;
      reasons.push("High token-overlap name candidate");
    }

    if (mention.hintedType && entity.entityType === mention.hintedType && score > 0) {
      score = Math.min(0.99, score + 0.04);
      reasons.push("Entity type agrees; type agreement does not prove identity");
    }

    if (mention.externalIds) {
      const externalMatches = Object.entries(mention.externalIds).filter(
        ([key, value]) => entity.externalIds[key] === value,
      );
      if (externalMatches.length > 0) {
        score = 1;
        scoreSemantics = "deterministic_exact_external_identifier_match";
        autoResolvable = true;
        reasons.push("Exact external identifier match");
      }
    }

    if (score > 0) candidates.push({ entity, score, scoreSemantics, autoResolvable, reasons });
  }

  return candidates.sort((a, b) => b.score - a.score)[0];
}

/**
 * Automatic relationship promotion is intentionally disabled in the generic
 * perception layer. Distinct source identifiers and extractor scores do not prove
 * source independence or relationship truth. Promotion belongs to a governed,
 * auditable verification workflow.
 */
export function relationshipPromotionEligible(
  _claim: Pick<EvidenceClaim, "epistemicStatus" | "confidence" | "provenance" | "metadata">,
): boolean {
  return false;
}

function exactEntityResolution(
  entityId: string,
  entities: WorldEntity[],
): EntityResolutionCandidate | undefined {
  const entity = entities.find((candidate) => candidate.id === entityId);
  return entity ? {
    entity,
    score: 1,
    scoreSemantics: "deterministic_supplied_known_entity_id_match",
    autoResolvable: true,
    reasons: ["Extractor supplied an entity id that exists in the known canonical set"],
  } : undefined;
}

function newestObservedAt(provenance: ExtractionCandidate["provenance"]): string {
  const timestamps = provenance
    .map((source) => Date.parse(source.observedAt))
    .filter(Number.isFinite);
  return timestamps.length > 0
    ? new Date(Math.max(...timestamps)).toISOString()
    : new Date().toISOString();
}

function entityResolvedEvent(
  resolution: EntityResolutionCandidate,
  producer: string,
  resolvedAt: string,
  candidate: ExtractionCandidate,
): CognitiveEvent {
  return {
    eventType: "entity.resolved",
    epistemicStatus: "derived",
    confidence: null,
    confidenceSemantics: "not_applicable_deterministic_identity_resolution_record",
    subjectEntityId: resolution.entity.id,
    occurredAt: resolvedAt,
    observedAt: resolvedAt,
    timeSemantics: "system_resolution_time",
    producer,
    payload: {
      canonicalName: resolution.entity.canonicalName,
      entityType: resolution.entity.entityType,
      resolutionScore: resolution.score,
      resolutionScoreSemantics: resolution.scoreSemantics,
      autoResolvable: resolution.autoResolvable,
    },
    provenance: candidate.provenance,
  };
}
