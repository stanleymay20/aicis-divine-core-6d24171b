import { z } from "zod";

/**
 * Shared contracts for the AICIS cognitive substrate.
 *
 * Design rule: generated language is never implicitly trusted knowledge.
 * Every fact-like object carries an epistemic state, confidence and provenance.
 */
export const epistemicStatusSchema = z.enum([
  "observed",
  "derived",
  "inferred",
  "predicted",
  "hypothesized",
  "simulated",
  "unverified",
  "contradicted",
]);
export type EpistemicStatus = z.infer<typeof epistemicStatusSchema>;

export const relationshipStatusSchema = z.enum([
  "proposed",
  "verified",
  "rejected",
  "superseded",
]);
export type RelationshipStatus = z.infer<typeof relationshipStatusSchema>;

export const cognitiveEventTypeSchema = z.enum([
  "signal.observed",
  "entity.resolved",
  "claim.extracted",
  "claim.verified",
  "claim.contradicted",
  "relationship.proposed",
  "relationship.verified",
  "event.detected",
  "anomaly.detected",
  "novelty.detected",
  "graph.updated",
  "topology.changed",
  "cascade.detected",
  "feedback_loop.detected",
  "hypothesis.created",
  "hypothesis.updated",
  "hypothesis.refuted",
  "forecast.generated",
  "decision.proposed",
  "decision.approved",
  "action.executed",
  "outcome.observed",
  "model.degraded",
  "sensor.degraded",
]);
export type CognitiveEventType = z.infer<typeof cognitiveEventTypeSchema>;

const confidenceSchema = z.number().min(0).max(1);

export const provenanceSchema = z.object({
  sourceId: z.string().trim().min(1).max(300),
  sourceType: z.string().trim().min(1).max(80),
  sourceUri: z.string().url().max(2_000).optional(),
  publishedAt: z.string().datetime().optional(),
  observedAt: z.string().datetime(),
  extractor: z.string().trim().max(160).optional(),
  extractorVersion: z.string().trim().max(80).optional(),
  evidenceHash: z.string().trim().max(256).optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const worldEntitySchema = z.object({
  id: z.string().uuid(),
  canonicalName: z.string().trim().min(1).max(500),
  entityType: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(500)).default([]),
  externalIds: z.record(z.string()).default({}),
  attributes: z.record(z.unknown()).default({}),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
});
export type WorldEntity = z.infer<typeof worldEntitySchema>;

export const evidenceClaimSchema = z.object({
  id: z.string().uuid(),
  statement: z.string().trim().min(1).max(10_000),
  subjectEntityId: z.string().uuid().optional(),
  predicate: z.string().trim().min(1).max(160).optional(),
  objectEntityId: z.string().uuid().optional(),
  objectValue: z.unknown().optional(),
  epistemicStatus: epistemicStatusSchema,
  confidence: confidenceSchema,
  occurredAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  provenance: z.array(provenanceSchema).min(1),
  metadata: z.record(z.unknown()).default({}),
});
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;

export const worldRelationshipSchema = z.object({
  id: z.string().uuid(),
  sourceEntityId: z.string().uuid(),
  targetEntityId: z.string().uuid(),
  relationshipType: z.string().trim().min(1).max(160),
  status: relationshipStatusSchema,
  epistemicStatus: epistemicStatusSchema,
  strength: confidenceSchema.optional(),
  confidence: confidenceSchema,
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  evidenceClaimIds: z.array(z.string().uuid()).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type WorldRelationship = z.infer<typeof worldRelationshipSchema>;

export const cognitiveEventSchema = z.object({
  id: z.string().uuid().optional(),
  eventType: cognitiveEventTypeSchema,
  epistemicStatus: epistemicStatusSchema,
  confidence: confidenceSchema,
  subjectEntityId: z.string().uuid().optional(),
  correlationId: z.string().uuid().optional(),
  causationId: z.string().uuid().optional(),
  occurredAt: z.string().datetime(),
  observedAt: z.string().datetime(),
  producer: z.string().trim().min(1).max(160),
  payload: z.record(z.unknown()).default({}),
  provenance: z.array(provenanceSchema).default([]),
});
export type CognitiveEvent = z.infer<typeof cognitiveEventSchema>;

export function isTrustedKnowledge(status: EpistemicStatus): boolean {
  return status === "observed" || status === "derived";
}

export function canEnterVerifiedGraph(
  status: EpistemicStatus,
  relationshipStatus: RelationshipStatus,
  confidence: number,
): boolean {
  return (
    relationshipStatus === "verified" &&
    status !== "unverified" &&
    status !== "contradicted" &&
    confidence >= 0.5
  );
}
