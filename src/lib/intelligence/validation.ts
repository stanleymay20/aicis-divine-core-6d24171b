/**
 * AICIS Intelligence Layer — Small-Sample Validation
 * Safe to run under DB load: uses LIMIT-ed queries and in-memory checks.
 */

import { supabase } from '@/integrations/supabase/client';
import { prepareEventLinks, buildExistingKeySet, chunkArray, type RawEventRow } from './event-linking';
import { evaluateTriggers, type TriggerEventInput } from './decision-triggers';
import { assessImpact } from './impact-model';
import { normalizeEventType } from './event-types';
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

  // 1. Fetch small sample — include domain, iso3, started_at for full pipeline test
  const { data: events, error: fetchErr } = await supabase
    .from('normalized_events')
    .select('id, entity_id, location_entity_id, event_type, severity, iso3, started_at')
    .order('created_at', { ascending: false })
    .limit(sampleSize);

  if (fetchErr) {
    errors.push(`Fetch error: ${fetchErr.message}`);
    return buildEmptyReport(sampleSize, errors, counters);
  }

  const rows = (events ?? []) as unknown as (RawEventRow & { iso3?: string; started_at?: string })[];

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

  // 4. Test impact model — infer domain from event_type when not available
  const impactRows = rows.filter(r => r.severity != null);
  const impacts = impactRows.map(r => {
    const domain = inferDomainFromEventType(r.event_type) || 'security';
    return assessImpact(r.severity!, r.severity! > 50 ? 0.7 : 0.5, domain as any);
  });

  const impactResult = {
    actionable: impacts.filter(i => i.isActionable).length,
    urgent: impacts.filter(i => i.isUrgent).length,
    avgAdjustedScore: impacts.length > 0
      ? Math.round(impacts.reduce((s, i) => s + i.adjustedScore, 0) / impacts.length)
      : 0,
  };

  // 5. Test decision triggers — use iso3 + started_at from actual rows
  const triggerInputs: TriggerEventInput[] = impactRows.map(r => ({
    id: r.id,
    event_type: normalizeEventType(r.event_type),
    severity: r.severity!,
    domain: (inferDomainFromEventType(r.event_type) || 'security') as any,
    iso3: (r as any).iso3 ?? undefined,
    occurred_at: (r as any).started_at ?? new Date().toISOString(),
    confidence: r.severity! > 50 ? 0.7 : 0.5,
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

/**
 * Infer an intelligence domain from a raw event_type string.
 * Used when `domain` column is absent from the DB row.
 */
function inferDomainFromEventType(eventType?: string | null): string | null {
  if (!eventType) return null;
  const lower = eventType.toLowerCase();
  if (lower.includes('conflict') || lower.includes('security') || lower.includes('terror')) return 'security';
  if (lower.includes('health') || lower.includes('pandemic') || lower.includes('epidemic')) return 'health';
  if (lower.includes('market') || lower.includes('financial') || lower.includes('economic')) return 'finance';
  if (lower.includes('climate') || lower.includes('weather') || lower.includes('flood') || lower.includes('drought')) return 'climate';
  if (lower.includes('food') || lower.includes('famine') || lower.includes('crop')) return 'food';
  if (lower.includes('energy') || lower.includes('oil') || lower.includes('power')) return 'energy';
  if (lower.includes('governance') || lower.includes('policy') || lower.includes('election') || lower.includes('diplomatic')) return 'governance';
  if (lower.includes('education') || lower.includes('school')) return 'education';
  if (lower.includes('population') || lower.includes('migration') || lower.includes('refugee')) return 'population';
  if (lower.includes('supply')) return 'finance';
  return null;
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
 * Post-72h: Run full event link generation via edge function (server-side, service role).
 * This is the SAFE path — calls the planetary-backfill edge function
 * which uses service role and can write to entity_event_links.
 * 
 * For client-side dry-run validation, use runSmallSampleValidation() instead.
 */
export async function runFullEventLinkGeneration(batchSize = 200): Promise<{
  totalLinks: number;
  totalSkipped: number;
  errors: string[];
}> {
  console.log('[AICIS] Triggering server-side event link generation...');

  const { data, error } = await supabase.functions.invoke('planetary-backfill', {
    body: { action: 'generate_event_links', batch_size: batchSize },
  });

  if (error) {
    console.error('[AICIS] Event link generation failed:', error.message);
    return { totalLinks: 0, totalSkipped: 0, errors: [error.message] };
  }

  console.log('[AICIS] Event link generation result:', data);
  return {
    totalLinks: data?.links_created ?? 0,
    totalSkipped: data?.skipped ?? 0,
    errors: data?.errors ?? [],
  };
}

/**
 * Client-side dry-run: prepare links without writing to DB.
 * Useful for validating logic before committing.
 */
export async function dryRunEventLinks(sampleSize = 100): Promise<{
  wouldCreate: number;
  wouldSkip: number;
  sampleEvents: number;
  existingLinks: number;
}> {
  const { data: events } = await supabase
    .from('normalized_events')
    .select('id, entity_id, location_entity_id, event_type, severity')
    .order('created_at', { ascending: false })
    .limit(sampleSize);

  const { data: existingLinks } = await supabase
    .from('entity_event_links')
    .select('event_id, entity_id, link_role')
    .limit(1000);

  const existingKeys = buildExistingKeySet(existingLinks ?? []);
  const { links, counters } = prepareEventLinks(
    (events ?? []) as unknown as RawEventRow[],
    existingKeys,
  );

  return {
    wouldCreate: links.length,
    wouldSkip: counters.recordsSkipped,
    sampleEvents: (events ?? []).length,
    existingLinks: existingKeys.size,
  };
}