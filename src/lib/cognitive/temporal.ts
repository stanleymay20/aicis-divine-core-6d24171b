export interface TemporalEvent {
  id: string;
  occurredAt?: string;
  observedAt: string;
  validFrom?: string;
  validTo?: string;
  confidence: number;
}

export type TemporalRelation =
  | "before"
  | "after"
  | "overlaps"
  | "contains"
  | "during"
  | "simultaneous"
  | "unknown";

export interface TemporalAssessment {
  relation: TemporalRelation;
  confidence: number;
  plausibleForwardCausation: boolean;
  lagMs?: number;
  reasons: string[];
}

/**
 * Deterministic temporal consistency check. It never proves causality; it only
 * rejects or weakens causal stories that violate observed ordering.
 */
export function assessTemporalRelation(
  cause: TemporalEvent,
  effect: TemporalEvent,
  toleranceMs = 60_000,
): TemporalAssessment {
  const causeStart = parseTime(cause.occurredAt ?? cause.validFrom ?? cause.observedAt);
  const causeEnd = parseTime(cause.validTo ?? cause.occurredAt ?? cause.observedAt);
  const effectStart = parseTime(effect.occurredAt ?? effect.validFrom ?? effect.observedAt);
  const effectEnd = parseTime(effect.validTo ?? effect.occurredAt ?? effect.observedAt);
  const reasons: string[] = [];

  if ([causeStart, causeEnd, effectStart, effectEnd].some((value) => value === null)) {
    return {
      relation: "unknown",
      confidence: 0.2,
      plausibleForwardCausation: false,
      reasons: ["One or more event timestamps are missing or invalid"],
    };
  }

  const cs = causeStart as number;
  const ce = causeEnd as number;
  const es = effectStart as number;
  const ee = effectEnd as number;
  const confidence = clamp01(Math.min(cause.confidence, effect.confidence));

  if (ce < es - toleranceMs) {
    const lagMs = es - ce;
    reasons.push("Proposed cause precedes the effect");
    return { relation: "before", confidence, plausibleForwardCausation: true, lagMs, reasons };
  }

  if (cs > ee + toleranceMs) {
    reasons.push("Proposed cause occurs after the effect; ordinary forward causation is temporally inconsistent");
    return {
      relation: "after",
      confidence,
      plausibleForwardCausation: false,
      lagMs: es - ce,
      reasons,
    };
  }

  if (Math.abs(cs - es) <= toleranceMs && Math.abs(ce - ee) <= toleranceMs) {
    reasons.push("Events are approximately simultaneous; temporal order alone cannot distinguish cause from effect");
    return { relation: "simultaneous", confidence: confidence * 0.7, plausibleForwardCausation: false, reasons };
  }

  if (cs <= es && ce >= ee) {
    reasons.push("Effect occurs during the proposed cause interval");
    return { relation: "contains", confidence, plausibleForwardCausation: true, lagMs: Math.max(0, es - cs), reasons };
  }

  if (es <= cs && ee >= ce) {
    reasons.push("Proposed cause is nested inside the effect interval; direction is ambiguous");
    return { relation: "during", confidence: confidence * 0.6, plausibleForwardCausation: false, reasons };
  }

  reasons.push("Event intervals overlap; temporal precedence is only partially established");
  return {
    relation: "overlaps",
    confidence: confidence * 0.65,
    plausibleForwardCausation: cs <= es,
    lagMs: es - cs,
    reasons,
  };
}

export interface TemporalSequenceFinding {
  eventIds: string[];
  monotonic: boolean;
  minLagMs?: number;
  maxLagMs?: number;
  violations: Array<{ earlierId: string; laterId: string }>;
}

export function assessTemporalSequence(events: TemporalEvent[]): TemporalSequenceFinding {
  if (events.length < 2) return { eventIds: events.map((item) => item.id), monotonic: true, violations: [] };

  const violations: Array<{ earlierId: string; laterId: string }> = [];
  const lags: number[] = [];

  for (let index = 0; index < events.length - 1; index += 1) {
    const assessment = assessTemporalRelation(events[index], events[index + 1]);
    if (!assessment.plausibleForwardCausation) {
      violations.push({ earlierId: events[index].id, laterId: events[index + 1].id });
    }
    if (typeof assessment.lagMs === "number" && assessment.lagMs >= 0) lags.push(assessment.lagMs);
  }

  return {
    eventIds: events.map((item) => item.id),
    monotonic: violations.length === 0,
    minLagMs: lags.length ? Math.min(...lags) : undefined,
    maxLagMs: lags.length ? Math.max(...lags) : undefined,
    violations,
  };
}

export interface EventWindow {
  start: string;
  end: string;
  eventIds: string[];
}

/** Groups events into proximity windows for episode/cascade reasoning. */
export function groupTemporalWindows(events: TemporalEvent[], gapMs: number): EventWindow[] {
  const sorted = events
    .map((event) => ({ event, time: parseTime(event.occurredAt ?? event.observedAt) }))
    .filter((item): item is { event: TemporalEvent; time: number } => item.time !== null)
    .sort((a, b) => a.time - b.time);

  if (!sorted.length) return [];
  const windows: EventWindow[] = [];
  let current = {
    start: sorted[0].time,
    end: sorted[0].time,
    eventIds: [sorted[0].event.id],
  };

  for (const item of sorted.slice(1)) {
    if (item.time - current.end <= gapMs) {
      current.end = item.time;
      current.eventIds.push(item.event.id);
    } else {
      windows.push({
        start: new Date(current.start).toISOString(),
        end: new Date(current.end).toISOString(),
        eventIds: current.eventIds,
      });
      current = { start: item.time, end: item.time, eventIds: [item.event.id] };
    }
  }

  windows.push({
    start: new Date(current.start).toISOString(),
    end: new Date(current.end).toISOString(),
    eventIds: current.eventIds,
  });
  return windows;
}

function parseTime(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
