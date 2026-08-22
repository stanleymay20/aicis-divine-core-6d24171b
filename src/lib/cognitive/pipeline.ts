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
  reasons: string[];
}

export interface PerceptionPipelineInput {
  candidate: ExtractionCandidate;
  subjectMention?: EntityMention;
  objectMention?: EntityMention;
  knownEntities: WorldEntity[];
  occurredAt?: string;
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
 * Deterministic pre-knowledge pipeline. It turns NLP output into auditable drafts,
 * never directly into verified graph state. Entity resolution and evidence status
 * are made explicit so downstream code can require a human/rule-based promotion.
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

  const occurredAt = input.occurredAt ?? newestObservedAt(input.candidate.provenance);
  const subjectEntityId = subjectResolution?.score === 1
    ? subjectResolution.entity.id
    : input.candidate.subjectEntityId;
  const objectEntityId = objectResolution?.score === 1
    ? objectResolution.entity.id
    : input.candidate.objectEntityId;

  const claimDraft: Omit<EvidenceClaim, "id"> = {
    statement: input.candidate.statement,
    subjectEntityId,
    predicate: input.candidate.predicate,
    objectEntityId,
    objectValue: input.candidate.objectValue,
    epistemicStatus: assessment.epistemicStatus,
    confidence: assessment.confidence,
    occurredAt,
    provenance: input.candidate.provenance,
    metadata: {
      ...(input.candidate.metadata ?? {}),
      perception: {
        independentSources: assessment.independentSources,
        sourceTypes: assessment.sourceTypes,
        hasDirectObservation: assessment.hasDirectObservation,
        reasons: assessment.reasons,
        subjectResolutionScore: subjectResolution?.score ?? null,
        objectResolutionScore: objectResolution?.score ?? null,
      },
    },
  };

  const events: CognitiveEvent[] = [
    {
      eventType: "claim.extracted",
      epistemicStatus: assessment.epistemicStatus,
      confidence: assessment.confidence,
      subjectEntityId,
      occurredAt,
      observedAt: newestObservedAt(input.candidate.provenance),
      producer: input.producer,
      payload: {
        statement: input.candidate.statement,
        predicate: input.candidate.predicate ?? null,
        objectEntityId: objectEntityId ?? null,
        independentSources: assessment.independentSources,
        assessmentReasons: assessment.reasons,
      },
      provenance: input.candidate.provenance,
    },
  ];

  if (subjectResolution?.score === 1) {
    events.push(entityResolvedEvent(subjectResolution.entity, input.producer, occurredAt, input.candidate));
  }
  if (objectResolution?.score === 1 && objectResolution.entity.id !== subjectResolution?.entity.id) {
    events.push(entityResolvedEvent(objectResolution.entity, input.producer, occurredAt, input.candidate));
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
      strength: assessment.confidence,
      confidence: assessment.confidence,
      validFrom: occurredAt,
      evidenceClaimIds: [],
      metadata: {
        generatedBy: "perception-pipeline",
        promotionRequired: true,
      },
    };

    events.push({
      eventType: "relationship.proposed",
      epistemicStatus: assessment.epistemicStatus,
      confidence: assessment.confidence,
      subjectEntityId,
      occurredAt,
      observedAt: newestObservedAt(input.candidate.provenance),
      producer: input.producer,
      payload: {
        sourceEntityId: subjectEntityId,
        targetEntityId: objectEntityId,
        relationshipType: input.candidate.predicate,
        promotionRequired: true,
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
 * Candidate resolver for canonical identity. A score below 1 is intentionally not
 * auto-promoted: fuzzy matches remain suggestions because a wrong merge can poison
 * the planetary graph more seriously than leaving an entity temporarily unresolved.
 */
export function resolveEntityMention(
  mention: EntityMention | undefined,
  entities: WorldEntity[],
): EntityResolutionCandidate | undefined {
  if (!mention?.text.trim()) return undefined;

  const candidates: EntityResolutionCandidate[] = [];
  for (const entity of entities) {
    let score = 0;
    const reasons: string[] = [];

    if (entity.canonicalName.trim().toLocaleLowerCase() === mention.text.trim().toLocaleLowerCase()) {
      score = 1;
      reasons.push("Exact canonical-name match");
    } else if (entity.aliases.some((alias) => alias.trim().toLocaleLowerCase() === mention.text.trim().toLocaleLowerCase())) {
      score = 1;
      reasons.push("Exact alias match");
    } else if (
      mentionsLikelyMatch(entity.canonicalName, mention.text) ||
      entity.aliases.some((alias) => mentionsLikelyMatch(alias, mention.text))
    ) {
      score = Math.max(score, 0.82);
      reasons.push("High token-overlap name match");
    }

    if (mention.hintedType && entity.entityType === mention.hintedType) {
      score = Math.min(1, score + 0.08);
      reasons.push("Entity type agrees");
    }

    if (mention.externalIds) {
      const externalMatches = Object.entries(mention.externalIds).filter(
        ([key, value]) => entity.externalIds[key] === value,
      );
      if (externalMatches.length > 0) {
        score = 1;
        reasons.push("External identifier match");
      }
    }

    if (score > 0) candidates.push({ entity, score, reasons });
  }

  return candidates.sort((a, b) => b.score - a.score)[0];
}

export function relationshipPromotionEligible(
  claim: Pick<EvidenceClaim, "epistemicStatus" | "confidence" | "provenance">,
  independentSourceMinimum = 2,
): boolean {
  if (claim.epistemicStatus === "unverified" || claim.epistemicStatus === "contradicted") {
    return false;
  }
  const independentSources = new Set(claim.provenance.map((source) => source.sourceId)).size;
  return claim.confidence >= 0.7 && independentSources >= independentSourceMinimum;
}

function exactEntityResolution(
  entityId: string,
  entities: WorldEntity[],
): EntityResolutionCandidate | undefined {
  const entity = entities.find((candidate) => candidate.id === entityId);
  return entity ? { entity, score: 1, reasons: ["Extractor supplied a known entity id"] } : undefined;
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
  entity: WorldEntity,
  producer: string,
  occurredAt: string,
  candidate: ExtractionCandidate,
): CognitiveEvent {
  return {
    eventType: "entity.resolved",
    epistemicStatus: "derived",
    confidence: 1,
    subjectEntityId: entity.id,
    occurredAt,
    observedAt: newestObservedAt(candidate.provenance),
    producer,
    payload: {
      canonicalName: entity.canonicalName,
      entityType: entity.entityType,
    },
    provenance: candidate.provenance,
  };
}
