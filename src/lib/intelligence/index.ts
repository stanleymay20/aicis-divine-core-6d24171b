/**
 * AICIS Intelligence Layer — Public API
 */

// Event taxonomy
export {
  EVENT_TYPES, URGENCY_LEVELS, SEVERITY_BANDS, INTELLIGENCE_DOMAINS, EVENT_LINK_ROLES,
  classifySeverity, isEscalatory, isRecovery, estimateUrgency, normalizeEventType,
  type EventType, type UrgencyLevel, type SeverityBand, type IntelligenceDomain,
  type EventLinkRole, type IntelligenceEvent,
} from './event-types';

// Event linking
export {
  prepareEventLinks, chunkArray, buildExistingKeySet,
  type PreparedEventLink, type RawEventRow,
} from './event-linking';

// Decision triggers
export {
  evaluateTriggers,
  type DecisionTrigger, type TriggerType, type TriggerConfig, type TriggerEventInput,
} from './decision-triggers';

// Impact model
export {
  assessImpact, batchAssessImpact,
  type ImpactAssessment, type ImpactModelConfig, type GeoVulnerabilityTier,
} from './impact-model';

// Observability
export {
  createCounters, incrementCounter, summarizeCounters, createThrottledLogger,
  type PipelineCounters,
} from './observability';

// Validation
export {
  runSmallSampleValidation, runFullEventLinkGeneration, dryRunEventLinks,
  type ValidationReport,
} from './validation';