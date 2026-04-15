/**
 * AICIS Intelligence Layer — Small-Sample Validation
 * Safe to run under DB load: uses LIMIT-ed queries and in-memory checks.
 */

import { supabase } from '@/integrations/supabase/client';
import { prepareEventLinks, buildExistingKeySet, type RawEventRow } from './event-linking';
import { evaluateTriggers, type TriggerEventInput } from './decision-triggers';
import { assessImpact } from './impact-model';
import { normalizeEventType, estimateUrgency } from './event-types';
import { createCounters, summarizeCounters } from './observability';

export interface ValidationReport {
  timestamp: string;
  sampleSize: number;
  linkingResult: {
    linksPrepared: number;
    duplicatesSkipped: number;
    skippedNoEntity: number;
  };
  triggerResult: {
    triggersGenerated: number;
    triggerTypes: Record<string, number>;
  };
  impactResult: {
    actionable: number;
    urgent: number;
    avgAdjustedScore: number;
  };
  typeNormalization: {
    inputTypes: string[];
    normalizedTypes: string[];
    unmapped: number;
  };
  counters: Record<string, number | string>;
  errors: string[];
}

/**
 * Run a safe validation against a small sample of recent events.
 * Default sample: 50 rows. Safe under high DB load.
 */
export async function runSmallSampleValidation(
  sampleSize = 50,
): Promise<ValidationReport> {
  const errors: string[] = [];
  const counters = createCounters();

  // 1. Fetch small sample
  const { data: events, error: fetchErr } = await supabase
    .from('normalized_events')
    .select('id, entity_id, location_entity_id, event_type, severity')
    .order('created_at', { ascending: false })
    .limit(sampleSize);

  if (fetchErr) {
    errors.push(`Fetch error: ${fetchErr.message}`);
    return buildEmptyReport(sampleSize, errors, counters);
  }

  const rows = (events ?? []) as unknown as RawEventRow[];

  // 2. Test event linking (no DB writes)
  const existingKeys = new Set<string>(); // Empty = treat all as new
  const { links, counters: linkCounters } = prepareEventLinks(rows, existingKeys, counters);

  const linkingResult = {
    linksPrepared: linkCounters.linksPrepared,
    duplicatesSkipped: linkCounters.linksSkippedDuplicate,
    skippedNoEntity: linkCounters.recordsSkipped,
  };

  // 3. Test type normalization
  const rawTypes = rows.map(r => r.event_type ?? 'unknown');
  const normalizedTypes = rawTypes.map(t => normalizeEventType(t));
  const unmapped = normalizedTypes.filter(t => t === 'anomaly').length;

  // 4. Test impact model
  const impacts = rows
    .filter(r => r.severity != null && r.domain)
    .map(r => assessImpact(r.severity!, 0.6, r.domain as any));

  const impactResult = {
    actionable: impacts.filter(i => i.isActionable).length,
    urgent: impacts.filter(i => i.isUrgent).length,
    avgAdjustedScore: impacts.length > 0
      ? Math.round(impacts.reduce((s, i) => s + i.adjustedScore, 0) / impacts.length)
      : 0,
  };

  // 5. Test decision triggers
  const triggerInputs: TriggerEventInput[] = rows
    .filter(r => r.severity != null && r.domain)
    .map(r => ({
      id: r.id,
      event_type: normalizeEventType(r.event_type),
      severity: r.severity!,
      domain: r.domain as any,
      occurred_at: new Date().toISOString(), // approximate for sample
      confidence: 0.6,
    }));

  const triggers = evaluateTriggers(triggerInputs, {}, counters);
  const triggerTypes: Record<string, number> = {};
  for (const t of triggers) {
    triggerTypes[t.triggerType] = (triggerTypes[t.triggerType] ?? 0) + 1;
  }

  return {
    timestamp: new Date().toISOString(),
    sampleSize: rows.length,
    linkingResult,
    triggerResult: {
      triggersGenerated: triggers.length,
      triggerTypes,
    },
    impactResult,
    typeNormalization: {
      inputTypes: [...new Set(rawTypes)],
      normalizedTypes: [...new Set(normalizedTypes)],
      unmapped,
    },
    counters: summarizeCounters(counters),
    errors,
  };
}

function buildEmptyReport(
  sampleSize: number,
  errors: string[],
  counters: ReturnType<typeof createCounters>,
): ValidationReport {
  return {
    timestamp: new Date().toISOString(),
    sampleSize: 0,
    linkingResult: { linksPrepared: 0, duplicatesSkipped: 0, skippedNoEntity: 0 },
    triggerResult: { triggersGenerated: 0, triggerTypes: {} },
    impactResult: { actionable: 0, urgent: 0, avgAdjustedScore: 0 },
    typeNormalization: { inputTypes: [], normalizedTypes: [], unmapped: 0 },
    counters: summarizeCounters(counters),
    errors,
  };
}

/**
 * Post-72h: Run full event link generation.
 * Call this ONLY after DB load has dropped.
 * Uses batched reads and writes to avoid overwhelming the DB.
 */
export async function runFullEventLinkGeneration(batchSize = 500) {
  console.log('[AICIS] Starting full event link generation...');

  let offset = 0;
  let totalLinks = 0;
  let totalSkipped = 0;
  const globalCounters = createCounters();

  // Build existing key set from current links
  const { data: existingLinks } = await supabase
    .from('entity_event_links')
    .select('event_id, entity_id, link_role');

  const existingKeys = buildExistingKeySet(existingLinks ?? []);
  console.log(`[AICIS] Existing links in DB: ${existingKeys.size}`);

  while (true) {
    const { data: batch } = await supabase
      .from('normalized_events')
      .select('id, entity_id, location_entity_id, event_type, severity')
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;

    const { links, counters } = prepareEventLinks(batch as unknown as RawEventRow[], existingKeys, globalCounters);

    if (links.length > 0) {
      const { error } = await supabase
        .from('entity_event_links')
        .upsert(links.map(l => ({
          event_id: l.event_id,
          entity_id: l.entity_id,
          link_role: l.link_role,
        })), { onConflict: 'event_id,entity_id,link_role' });

      if (error) {
        console.error(`[AICIS] Batch insert error at offset ${offset}:`, error.message);
      } else {
        totalLinks += links.length;
        // Add new links to existing set to prevent duplicates in subsequent batches
        for (const l of links) {
          existingKeys.add(`${l.event_id}|${l.entity_id}|${l.link_role}`);
        }
      }
    }

    totalSkipped += counters.recordsSkipped;
    offset += batchSize;

    if (batch.length < batchSize) break; // Last batch
  }

  const summary = summarizeCounters(globalCounters);
  console.log('[AICIS] Full event link generation complete:', summary);
  return { totalLinks, totalSkipped, ...summary };
}
