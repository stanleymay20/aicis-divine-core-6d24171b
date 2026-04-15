/**
 * AICIS Event Linking Logic
 * Prepares idempotent event → entity, event → location, event → domain links.
 * All functions produce link records; actual DB writes are batched externally.
 */

import { type EventLinkRole } from './event-types';
import { createCounters, incrementCounter, type PipelineCounters } from './observability';

// ── Link Record ────────────────────────────────────────────────────
export interface PreparedEventLink {
  event_id: string;
  entity_id: string;
  link_role: EventLinkRole;
  domain?: string;
  confidence?: number;
}

// ── Raw event shape (minimal fields needed from normalized_events) ──
export interface RawEventRow {
  id: string;
  entity_id?: string | null;
  location_entity_id?: string | null;
  event_type?: string | null;
  domain?: string | null;
  severity?: number | null;
}

// ── Deduplication Set ──────────────────────────────────────────────
function linkKey(eventId: string, entityId: string, role: EventLinkRole): string {
  return `${eventId}|${entityId}|${role}`;
}

/**
 * Prepare links for a batch of events.
 * Idempotent: uses `existingKeys` set to skip already-linked pairs.
 * Returns prepared links + updated counters.
 */
export function prepareEventLinks(
  events: RawEventRow[],
  existingKeys: Set<string>,
  counters?: PipelineCounters,
): { links: PreparedEventLink[]; counters: PipelineCounters } {
  const c = counters ?? createCounters();
  const links: PreparedEventLink[] = [];
  const batchKeys = new Set<string>();

  for (const evt of events) {
    incrementCounter(c, 'eventsProcessed');

    if (!evt.id) {
      incrementCounter(c, 'recordsSkipped');
      continue;
    }

    // Primary entity link
    if (evt.entity_id) {
      const key = linkKey(evt.id, evt.entity_id, 'primary');
      if (!existingKeys.has(key) && !batchKeys.has(key)) {
        links.push({
          event_id: evt.id,
          entity_id: evt.entity_id,
          link_role: 'primary',
          domain: evt.domain ?? undefined,
        });
        batchKeys.add(key);
        incrementCounter(c, 'linksPrepared');
      } else {
        incrementCounter(c, 'linksSkippedDuplicate');
      }
    }

    // Location entity link
    if (evt.location_entity_id && evt.location_entity_id !== evt.entity_id) {
      const key = linkKey(evt.id, evt.location_entity_id, 'location');
      if (!existingKeys.has(key) && !batchKeys.has(key)) {
        links.push({
          event_id: evt.id,
          entity_id: evt.location_entity_id,
          link_role: 'location',
          domain: evt.domain ?? undefined,
        });
        batchKeys.add(key);
        incrementCounter(c, 'linksPrepared');
      } else {
        incrementCounter(c, 'linksSkippedDuplicate');
      }
    }

    // Skip events with no linkable entity
    if (!evt.entity_id && !evt.location_entity_id) {
      incrementCounter(c, 'recordsSkipped');
    }
  }

  return { links, counters: c };
}

/**
 * Chunk an array into batches of `size`.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Build the existing-keys set from DB rows (for idempotency check).
 * Call with a small sample during load; full set after 72h window.
 */
export function buildExistingKeySet(
  rows: Array<{ event_id: string; entity_id: string; link_role: string }>
): Set<string> {
  const set = new Set<string>();
  for (const r of rows) {
    set.add(linkKey(r.event_id, r.entity_id, r.link_role as EventLinkRole));
  }
  return set;
}
