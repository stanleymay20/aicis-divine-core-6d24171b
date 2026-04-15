/**
 * AICIS Intelligence Pipeline — Lightweight Observability
 * In-memory counters for pipeline runs. No DB writes in tight loops.
 */

export interface PipelineCounters {
  eventsProcessed: number;
  linksPrepared: number;
  linksSkippedDuplicate: number;
  triggersGenerated: number;
  triggersSuppressed: number;
  recordsSkipped: number;
  errors: number;
  startedAt: number;
}

export function createCounters(): PipelineCounters {
  return {
    eventsProcessed: 0,
    linksPrepared: 0,
    linksSkippedDuplicate: 0,
    triggersGenerated: 0,
    triggersSuppressed: 0,
    recordsSkipped: 0,
    errors: 0,
    startedAt: Date.now(),
  };
}

export function incrementCounter(c: PipelineCounters, key: keyof Omit<PipelineCounters, 'startedAt'>, amount = 1) {
  (c[key] as number) += amount;
}

export function summarizeCounters(c: PipelineCounters): Record<string, number | string> {
  const elapsed = Date.now() - c.startedAt;
  return {
    events_processed: c.eventsProcessed,
    links_prepared: c.linksPrepared,
    links_skipped_duplicate: c.linksSkippedDuplicate,
    triggers_generated: c.triggersGenerated,
    triggers_suppressed: c.triggersSuppressed,
    records_skipped: c.recordsSkipped,
    errors: c.errors,
    elapsed_ms: elapsed,
    throughput_per_sec: elapsed > 0 ? Math.round((c.eventsProcessed / elapsed) * 1000) : 0,
  };
}

/** Conditional log that avoids flooding — logs at most every `intervalMs`. */
export function createThrottledLogger(label: string, intervalMs = 5000) {
  let lastLog = 0;
  return (message: string, data?: Record<string, unknown>) => {
    const now = Date.now();
    if (now - lastLog >= intervalMs) {
      console.log(`[${label}] ${message}`, data ? JSON.stringify(data) : '');
      lastLog = now;
    }
  };
}
