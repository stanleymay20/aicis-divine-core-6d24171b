/**
 * AICIS Entity Resolution Service
 * Client-side service for resolving, searching, and managing canonical entities.
 */
import { supabase } from "@/integrations/supabase/client";

export type EntityType = 'company' | 'country' | 'city' | 'person' | 'asset' | 'product' | 'event' | 'policy' | 'sector' | 'commodity';
export type EntityAliasType = 'name' | 'ticker' | 'lei' | 'registry_id' | 'iso_code' | 'fips' | 'osm_id' | 'abbreviation' | 'acronym' | 'isin' | 'cusip' | 'duns';
export type EntityLinkType = 'subsidiary' | 'parent' | 'headquartered_in' | 'operates_in' | 'trades_in' | 'supplies' | 'competes_with' | 'regulates' | 'member_of' | 'borders' | 'capital_of';

export interface CanonicalEntity {
  id: string;
  entity_type: EntityType;
  canonical_name: string;
  display_name: string | null;
  iso3: string | null;
  lat: number | null;
  lon: number | null;
  metadata: Record<string, any>;
  trust_score: number;
  source_count: number;
  last_resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityAlias {
  id: string;
  entity_id: string;
  alias: string;
  alias_type: EntityAliasType;
  source: string | null;
  confidence: number;
}

export interface EntityLink {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  link_type: EntityLinkType;
  strength: number;
  source: string | null;
  metadata: Record<string, any>;
}

export interface ResolveResult {
  resolved: boolean;
  entity?: CanonicalEntity;
  match_type?: 'exact' | 'alias' | 'external_id' | 'fuzzy';
  match_confidence?: number;
}

export interface EntityGraph {
  entity: CanonicalEntity;
  aliases: EntityAlias[];
  external_ids: Array<{ provider: string; external_id: string; external_type: string | null }>;
  relationships: {
    outgoing: Array<EntityLink & { target: Partial<CanonicalEntity> }>;
    incoming: Array<EntityLink & { source: Partial<CanonicalEntity> }>;
  };
}

// ─── Invoke edge function helper ────────────────────────────────────
async function invokeEntityFn(action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke("entity-resolve", {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message);
  return data;
}

// ─── Public API ─────────────────────────────────────────────────────

export async function resolveEntity(
  name: string,
  entityType: EntityType,
  options?: { iso3?: string; external_ids?: Array<{ provider: string; external_id: string }> }
): Promise<ResolveResult> {
  return invokeEntityFn("resolve", {
    name,
    entity_type: entityType,
    iso3: options?.iso3,
    external_ids: options?.external_ids,
  });
}

export async function registerEntity(params: {
  name: string;
  entity_type: EntityType;
  display_name?: string;
  iso3?: string;
  lat?: number;
  lon?: number;
  metadata?: Record<string, any>;
  aliases?: Array<{ alias: string; type?: EntityAliasType; source?: string; confidence?: number }>;
  external_ids?: Array<{ provider: string; external_id: string; external_type?: string }>;
}): Promise<{ ok: boolean; entity: CanonicalEntity }> {
  return invokeEntityFn("register", params);
}

export async function linkEntities(params: {
  source_id: string;
  target_id: string;
  link_type: EntityLinkType;
  strength?: number;
  source?: string;
  metadata?: Record<string, any>;
}): Promise<{ ok: boolean; link: EntityLink }> {
  return invokeEntityFn("link", params);
}

export async function mergeEntities(params: {
  winner_id: string;
  loser_id: string;
  reason: string;
  confidence?: number;
}): Promise<{ ok: boolean; winner_id: string; loser_id: string; merged: boolean }> {
  return invokeEntityFn("merge", params);
}

export async function searchEntities(
  query: string,
  options?: { entity_type?: EntityType; iso3?: string; limit?: number }
): Promise<{ results: CanonicalEntity[]; count: number }> {
  return invokeEntityFn("search", { query, ...options });
}

export async function getEntityGraph(entityId: string, depth = 1): Promise<EntityGraph> {
  return invokeEntityFn("graph", { entity_id: entityId, depth });
}

// ─── Direct DB queries (for read-only, faster operations) ───────────

export async function searchEntitiesDirect(
  query: string,
  options?: { entity_type?: EntityType; iso3?: string; limit?: number }
): Promise<CanonicalEntity[]> {
  let q = supabase
    .from("canonical_entities")
    .select("*")
    .ilike("canonical_name", `%${query}%`)
    .limit(options?.limit || 20);

  if (options?.entity_type) q = q.eq("entity_type", options.entity_type);
  if (options?.iso3) q = q.eq("iso3", options.iso3);

  const { data } = await q;
  return (data as unknown as CanonicalEntity[]) || [];
}

export async function getEntityById(id: string): Promise<CanonicalEntity | null> {
  const { data } = await supabase
    .from("canonical_entities")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return (data as unknown as CanonicalEntity) || null;
}

export async function getEntityAliases(entityId: string): Promise<EntityAlias[]> {
  const { data } = await supabase
    .from("entity_aliases")
    .select("*")
    .eq("entity_id", entityId);

  return (data as unknown as EntityAlias[]) || [];
}

export async function getEntityLinks(entityId: string): Promise<{
  outgoing: EntityLink[];
  incoming: EntityLink[];
}> {
  const [{ data: out }, { data: inLinks }] = await Promise.all([
    supabase.from("entity_links").select("*").eq("source_entity_id", entityId),
    supabase.from("entity_links").select("*").eq("target_entity_id", entityId),
  ]);

  return {
    outgoing: (out as unknown as EntityLink[]) || [],
    incoming: (inLinks as unknown as EntityLink[]) || [],
  };
}
