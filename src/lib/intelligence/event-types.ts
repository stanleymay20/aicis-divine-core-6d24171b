/**
 * AICIS Event Intelligence — Type Taxonomy & Constants
 * Formalizes all event classifications used across the intelligence pipeline.
 */

// ── Canonical Event Types ──────────────────────────────────────────
export const EVENT_TYPES = [
  'disruption',
  'escalation',
  'anomaly',
  'recovery',
  'risk_increase',
  'risk_decrease',
  'propagation_alert',
  'structural_break',
  'policy_change',
  'conflict',
  'natural_disaster',
  'market_shock',
  'health_emergency',
  'supply_chain_break',
  'diplomatic_shift',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// ── Impact Urgency Levels ──────────────────────────────────────────
export const URGENCY_LEVELS = ['immediate', 'short_term', 'medium_term', 'long_term'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

// ── Event Severity Bands (numeric) ─────────────────────────────────
export const SEVERITY_BANDS = {
  negligible: { min: 0, max: 19, label: 'Negligible' },
  low:        { min: 20, max: 39, label: 'Low' },
  moderate:   { min: 40, max: 59, label: 'Moderate' },
  high:       { min: 60, max: 79, label: 'High' },
  critical:   { min: 80, max: 100, label: 'Critical' },
} as const;

export type SeverityBand = keyof typeof SEVERITY_BANDS;

// ── Domains ────────────────────────────────────────────────────────
export const INTELLIGENCE_DOMAINS = [
  'governance', 'health', 'energy', 'finance',
  'food', 'security', 'education', 'climate', 'population',
] as const;

export type IntelligenceDomain = (typeof INTELLIGENCE_DOMAINS)[number];

// ── Link Types ─────────────────────────────────────────────────────
export const EVENT_LINK_ROLES = ['primary', 'location', 'affected', 'source', 'related'] as const;
export type EventLinkRole = (typeof EVENT_LINK_ROLES)[number];

// ── Structured Event Envelope ──────────────────────────────────────
export interface IntelligenceEvent {
  id: string;
  event_type: EventType;
  severity: number;          // 0–100
  severityBand: SeverityBand;
  urgency: UrgencyLevel;
  domain: IntelligenceDomain;
  iso3?: string;
  entity_id?: string;
  location_entity_id?: string;
  title: string;
  description?: string;
  occurred_at: string;
  source?: string;
  confidence?: number;       // 0–1
}

// ── Helpers ────────────────────────────────────────────────────────

export function classifySeverity(score: number): SeverityBand {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'moderate';
  if (score >= 20) return 'low';
  return 'negligible';
}

export function isEscalatory(eventType: EventType): boolean {
  return ['escalation', 'risk_increase', 'propagation_alert', 'structural_break', 'conflict', 'market_shock'].includes(eventType);
}

export function isRecovery(eventType: EventType): boolean {
  return ['recovery', 'risk_decrease'].includes(eventType);
}

export function estimateUrgency(eventType: EventType, severity: number): UrgencyLevel {
  if (severity >= 80 && isEscalatory(eventType)) return 'immediate';
  if (severity >= 60) return 'short_term';
  if (severity >= 40) return 'medium_term';
  return 'long_term';
}

/** Map a raw event_type string to the canonical enum, falling back to 'anomaly'. */
export function normalizeEventType(raw: string | null | undefined): EventType {
  if (!raw) return 'anomaly';
  const lower = raw.toLowerCase().replace(/\s+/g, '_');
  if ((EVENT_TYPES as readonly string[]).includes(lower)) return lower as EventType;
  // Fuzzy fallbacks
  if (lower.includes('disrupt')) return 'disruption';
  if (lower.includes('escalat')) return 'escalation';
  if (lower.includes('recover')) return 'recovery';
  if (lower.includes('conflict') || lower.includes('war')) return 'conflict';
  if (lower.includes('disaster') || lower.includes('flood') || lower.includes('earthquake')) return 'natural_disaster';
  if (lower.includes('shock') || lower.includes('crash')) return 'market_shock';
  if (lower.includes('health') || lower.includes('epidemic') || lower.includes('pandemic')) return 'health_emergency';
  if (lower.includes('supply')) return 'supply_chain_break';
  if (lower.includes('policy')) return 'policy_change';
  if (lower.includes('diplom')) return 'diplomatic_shift';
  return 'anomaly';
}
