/**
 * AICIS Entity Resolution Service
 * Client contract mirrors the evidence-backed resolver: search/name similarity is
 * candidate evidence, while only verified identifiers or reviewed mappings resolve.
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
  metadata: Record<string, unknown>;
  trust_score: number | null;
  trust_score_semantics?: string | null;
  source_count: number | null;
  evidence_status?: string | null;
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
  confidence: number | null;
  confidence_semantics?: string | null;
  verification_status?: string | null;
}

export interface EntityLink {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  link_type: EntityLinkType;
  strength: number | null;
  strength_semantics?: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  provenance_source?: string | null;
  provenance_confidence?: number | null;
  provenance_confidence_semantics?: string | null;
  provenance_observed_at?: string | null;
  provenance_time_semantics?: string | null;
  verification_status?: string | null;
}

export interface ResolutionCandidate {
  entity: CanonicalEntity;
  match_type: 'exact_name' | 'alias' | 'fuzzy' | 'iso3';
  match_score: number | null;
  match_score_semantics: string;
  candidate_record_id: string | null;
  evidence: Record<string, unknown>;
}

export interface ResolveResult {
  resolved: boolean;
  resolution_status?: 'resolved_by_reviewed_mapping' | 'resolved_by_verified_external_identifier' | 'candidate_review_required' | 'unresolved_no_candidate';
  entity?: CanonicalEntity;
  match_type?: 'reviewed_candidate' | 'external_id';
  match_confidence?: number | null;
  match_confidence_semantics?: string;
  candidates?: ResolutionCandidate[];
}

export interface EntityGraph {
  entity: CanonicalEntity;
  aliases: EntityAlias[];
  external_ids: Array<{
    provider: string;
    external_id: string;
    external_type: string | null;
    verification_status?: string | null;
    verification_method?: string | null;
    last_verified_at?: string | null;
  }>;
  relationships: {
    outgoing: EntityLink[];
    incoming: EntityLink[];
  };
}

type EntityFunctionResponse = Record<string, unknown>;

async function invokeEntityFn<T extends EntityFunctionResponse>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("entity-resolve", {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message);
  return data as T;
}

export async function resolveEntity(
  name: string,
  entityType: EntityType,
  options?: { iso3?: string; external_ids?: Array<{ provider: string; external_id: string }> },
): Promise<ResolveResult> {
  return invokeEntityFn<ResolveResult & EntityFunctionResponse>("resolve", {
    name,
    entity_type: entityType,
    iso3: options?.iso3,
    external_ids: options?.external_ids,
  });
}

export async function reviewEntityCandidate(params: {
  candidate_id: string;
  decision: 'accepted' | 'rejected';
}): Promise<{ ok: boolean; decision: 'accepted' | 'rejected'; candidate: Record<string, unknown> }> {
  return invokeEntityFn("review_candidate", params);
}

export async function registerEntity(params: {
  name: string;
  entity_type: EntityType;
  display_name?: string;
  iso3?: string;
  lat?: number;
  lon?: number;
  metadata?: Record<string, unknown>;
  aliases?: Array<{
    alias: string;
    type?: EntityAliasType;
    source?: string;
    confidence?: number;
    confidence_semantics?: string;
  }>;
  external_ids?: Array<{
    provider: string;
    external_id: string;
    external_type?: string;
    verified?: boolean;
    verified_at?: string;
    verification_method?: string;
  }>;
}): Promise<{ ok: boolean; entity: CanonicalEntity }> {
  return invokeEntityFn("register", params);
}

export async function linkEntities(params: {
  source_id: string;
  target_id: string;
  link_type: EntityLinkType;
  strength?: number;
  strength_semantics?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  provenance_source?: string;
  provenance_confidence?: number;
  provenance_confidence_semantics?: string;
  provenance_observed_at?: string;
  provenance_time_semantics?: string;
  verification_status?: 'proposed' | 'verified';
}): Promise<{ ok: boolean; link: EntityLink }> {
  return invokeEntityFn("link", params);
}

export async function mergeEntities(params: {
  winner_id: string;
  loser_id: string;
  reason: string;
  confirm_merge: true;
  confidence?: number;
}): Promise<{
  ok: boolean;
  winner_id: string;
  loser_id: string;
  merged: boolean;
  merge_confidence: number | null;
  merge_confidence_semantics: string;
  merge_decision_semantics: string;
}> {
  return invokeEntityFn("merge", params);
}

export async function searchEntities(
  query: string,
  options?: { entity_type?: EntityType; iso3?: string; limit?: number },
): Promise<{
  results: Array<CanonicalEntity & {
    match_score?: number | null;
    match_score_semantics?: string;
    match_source?: string;
  }>;
  count: number;
  result_semantics?: string;
}> {
  return invokeEntityFn("search", { query, ...options });
}

export async function getEntityGraph(entityId: string, depth = 1): Promise<EntityGraph> {
  return invokeEntityFn<EntityGraph & EntityFunctionResponse>("graph", { entity_id: entityId, depth });
}

export async function searchEntitiesDirect(
  query: string,
  options?: { entity_type?: EntityType; iso3?: string; limit?: number },
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
