/**
 * AICIS Decision Trigger Engine
 * Rule-based evaluation of whether event/signal combinations are decision-worthy.
 * Returns structured trigger objects — no UI output.
 */

import {
  type EventType, type IntelligenceDomain, type SeverityBand,
  classifySeverity, isEscalatory,
} from './event-types';
import { type ImpactAssessment } from './impact-model';
import { incrementCounter, type PipelineCounters } from './observability';

// ── Trigger Output ─────────────────────────────────────────────────
export type TriggerType =
  | 'high_impact_urgent'
  | 'repeated_domain_stress'
  | 'multi_domain_compounding'
  | 'propagation_risk'
  | 'structural_break_cluster'
  | 'recovery_opportunity';

export interface DecisionTrigger {
  triggerType: TriggerType;
  severity: SeverityBand;
  score: number;               // 0–100 composite trigger score
  confidence: number;          // 0–1
  domains: IntelligenceDomain[];
  countries: string[];         // ISO3 codes
  eventIds: string[];          // contributing event IDs
  reason: string;              // machine-readable reason key
  metadata: Record<string, unknown>;
  generatedAt: string;
}

// ── Trigger Configuration ──────────────────────────────────────────
export interface TriggerConfig {
  highImpactThreshold: number;          // default 70
  repeatedStressMinCount: number;       // default 3
  repeatedStressWindowHours: number;    // default 48
  multiDomainMinDomains: number;        // default 2
  propagationRiskThreshold: number;     // default 60
  structuralBreakMinCount: number;      // default 2
  minConfidence: number;                // default 0.4
}

const DEFAULT_CONFIG: TriggerConfig = {
  highImpactThreshold: 70,
  repeatedStressMinCount: 3,
  repeatedStressWindowHours: 48,
  multiDomainMinDomains: 2,
  propagationRiskThreshold: 60,
  structuralBreakMinCount: 2,
  minConfidence: 0.4,
};

// ── Event Input (lightweight) ──────────────────────────────────────
export interface TriggerEventInput {
  id: string;
  event_type: EventType;
  severity: number;
  domain: IntelligenceDomain;
  iso3?: string;
  confidence?: number;
  occurred_at: string;
  impact?: ImpactAssessment;
  structuralBreak?: boolean;
  propagationRisk?: number;   // 0–100
}

// ── Rule Evaluators ────────────────────────────────────────────────

function evaluateHighImpactUrgent(
  events: TriggerEventInput[],
  cfg: TriggerConfig,
): DecisionTrigger[] {
  const triggers: DecisionTrigger[] = [];
  for (const e of events) {
    const score = e.impact?.adjustedScore ?? e.severity;
    const conf = e.confidence ?? e.impact?.confidence ?? 0.5;
    if (score >= cfg.highImpactThreshold && conf >= cfg.minConfidence && isEscalatory(e.event_type)) {
      triggers.push({
        triggerType: 'high_impact_urgent',
        severity: classifySeverity(score),
        score,
        confidence: conf,
        domains: [e.domain],
        countries: e.iso3 ? [e.iso3] : [],
        eventIds: [e.id],
        reason: 'single_event_high_impact_escalatory',
        metadata: { event_type: e.event_type },
        generatedAt: new Date().toISOString(),
      });
    }
  }
  return triggers;
}

function evaluateRepeatedDomainStress(
  events: TriggerEventInput[],
  cfg: TriggerConfig,
): DecisionTrigger[] {
  const triggers: DecisionTrigger[] = [];
  const windowMs = cfg.repeatedStressWindowHours * 3600_000;
  const now = Date.now();

  // Group by domain+country
  const groups = new Map<string, TriggerEventInput[]>();
  for (const e of events) {
    if (!e.iso3) continue;
    const elapsed = now - new Date(e.occurred_at).getTime();
    if (elapsed > windowMs) continue;
    const key = `${e.domain}|${e.iso3}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  for (const [key, group] of groups) {
    if (group.length >= cfg.repeatedStressMinCount) {
      const [domain, iso3] = key.split('|');
      const avgSev = group.reduce((s, e) => s + e.severity, 0) / group.length;
      triggers.push({
        triggerType: 'repeated_domain_stress',
        severity: classifySeverity(avgSev),
        score: Math.min(100, avgSev + group.length * 5),
        confidence: Math.min(1, 0.5 + group.length * 0.05),
        domains: [domain as IntelligenceDomain],
        countries: [iso3],
        eventIds: group.map(e => e.id),
        reason: 'repeated_events_same_domain_country',
        metadata: { count: group.length, avg_severity: Math.round(avgSev) },
        generatedAt: new Date().toISOString(),
      });
    }
  }
  return triggers;
}

function evaluateMultiDomainCompounding(
  events: TriggerEventInput[],
  cfg: TriggerConfig,
): DecisionTrigger[] {
  const triggers: DecisionTrigger[] = [];

  // Group by country
  const byCountry = new Map<string, TriggerEventInput[]>();
  for (const e of events) {
    if (!e.iso3 || e.severity < 40) continue;
    if (!byCountry.has(e.iso3)) byCountry.set(e.iso3, []);
    byCountry.get(e.iso3)!.push(e);
  }

  for (const [iso3, group] of byCountry) {
    const domains = [...new Set(group.map(e => e.domain))];
    if (domains.length >= cfg.multiDomainMinDomains) {
      const maxSev = Math.max(...group.map(e => e.severity));
      const compoundScore = Math.min(100, maxSev + domains.length * 8);
      triggers.push({
        triggerType: 'multi_domain_compounding',
        severity: classifySeverity(compoundScore),
        score: compoundScore,
        confidence: Math.min(1, 0.4 + domains.length * 0.1),
        domains: domains as IntelligenceDomain[],
        countries: [iso3],
        eventIds: group.map(e => e.id),
        reason: 'multi_domain_stress_single_country',
        metadata: { domain_count: domains.length },
        generatedAt: new Date().toISOString(),
      });
    }
  }
  return triggers;
}

function evaluatePropagationRisk(
  events: TriggerEventInput[],
  cfg: TriggerConfig,
): DecisionTrigger[] {
  return events
    .filter(e => (e.propagationRisk ?? 0) >= cfg.propagationRiskThreshold)
    .map(e => ({
      triggerType: 'propagation_risk' as TriggerType,
      severity: classifySeverity(e.propagationRisk!),
      score: e.propagationRisk!,
      confidence: e.confidence ?? 0.5,
      domains: [e.domain],
      countries: e.iso3 ? [e.iso3] : [],
      eventIds: [e.id],
      reason: 'propagation_risk_above_threshold',
      metadata: { propagation_score: e.propagationRisk },
      generatedAt: new Date().toISOString(),
    }));
}

function evaluateStructuralBreakCluster(
  events: TriggerEventInput[],
  cfg: TriggerConfig,
): DecisionTrigger[] {
  const breaks = events.filter(e => e.structuralBreak);
  if (breaks.length < cfg.structuralBreakMinCount) return [];

  const domains = [...new Set(breaks.map(e => e.domain))] as IntelligenceDomain[];
  const countries = [...new Set(breaks.filter(e => e.iso3).map(e => e.iso3!))];
  const maxSev = Math.max(...breaks.map(e => e.severity));

  return [{
    triggerType: 'structural_break_cluster',
    severity: classifySeverity(maxSev),
    score: Math.min(100, maxSev + breaks.length * 10),
    confidence: Math.min(1, 0.5 + breaks.length * 0.08),
    domains,
    countries,
    eventIds: breaks.map(e => e.id),
    reason: 'multiple_structural_breaks_detected',
    metadata: { break_count: breaks.length },
    generatedAt: new Date().toISOString(),
  }];
}

// ── Main Evaluator ─────────────────────────────────────────────────

/**
 * Evaluate all trigger rules against a set of recent events.
 * Returns deduplicated, scored triggers sorted by score desc.
 */
export function evaluateTriggers(
  events: TriggerEventInput[],
  config: Partial<TriggerConfig> = {},
  counters?: PipelineCounters,
): DecisionTrigger[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const c = counters;

  const all: DecisionTrigger[] = [
    ...evaluateHighImpactUrgent(events, cfg),
    ...evaluateRepeatedDomainStress(events, cfg),
    ...evaluateMultiDomainCompounding(events, cfg),
    ...evaluatePropagationRisk(events, cfg),
    ...evaluateStructuralBreakCluster(events, cfg),
  ];

  // Sort by score descending
  all.sort((a, b) => b.score - a.score);

  if (c) {
    incrementCounter(c, 'triggersGenerated', all.length);
  }

  return all;
}
