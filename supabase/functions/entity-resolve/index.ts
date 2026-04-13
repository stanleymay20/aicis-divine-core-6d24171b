import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { structuredLog, handleCors, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "entity-resolve";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { action, ...params } = await req.json();

    switch (action) {
      case "resolve": return await resolveEntity(supabase, params);
      case "register": return await registerEntity(supabase, params);
      case "link": return await linkEntities(supabase, params);
      case "merge": return await mergeEntities(supabase, params);
      case "search": return await searchEntities(supabase, params);
      case "graph": return await getEntityGraph(supabase, params);
      default:
        return errorResponse(new Error(`Unknown action: ${action}`), 400);
    }
  } catch (e) {
    structuredLog("error", FN, (e as Error).message);
    return errorResponse(e);
  }
});

// ─── Resolve: find or create canonical entity ────────────────────────
async function resolveEntity(supabase: any, params: any) {
  const { name, entity_type, iso3, aliases, external_ids } = params;
  if (!name || !entity_type) {
    return errorResponse(new Error("name and entity_type required"), 400);
  }

  // 1. Try exact match on canonical_name
  const { data: exact } = await supabase
    .from("canonical_entities")
    .select("*")
    .eq("entity_type", entity_type)
    .ilike("canonical_name", name)
    .limit(1)
    .maybeSingle();

  if (exact) {
    return jsonResponse({ resolved: true, entity: exact, match_type: "exact" });
  }

  // 2. Try alias match
  const { data: aliasMatch } = await supabase
    .from("entity_aliases")
    .select("entity_id, alias, confidence, canonical_entities(*)")
    .ilike("alias", name)
    .limit(1)
    .maybeSingle();

  if (aliasMatch?.canonical_entities) {
    return jsonResponse({
      resolved: true,
      entity: aliasMatch.canonical_entities,
      match_type: "alias",
      match_confidence: aliasMatch.confidence,
    });
  }

  // 3. Try external ID match
  if (external_ids && Array.isArray(external_ids)) {
    for (const ext of external_ids) {
      const { data: extMatch } = await supabase
        .from("entity_external_ids")
        .select("entity_id, canonical_entities(*)")
        .eq("provider", ext.provider)
        .eq("external_id", ext.external_id)
        .limit(1)
        .maybeSingle();

      if (extMatch?.canonical_entities) {
        return jsonResponse({
          resolved: true,
          entity: extMatch.canonical_entities,
          match_type: "external_id",
          matched_provider: ext.provider,
        });
      }
    }
  }

  // 4. Fuzzy match using trigram similarity
  const { data: fuzzy } = await supabase.rpc("similarity_search_entities", {
    search_name: name,
    search_type: entity_type,
    min_similarity: 0.3,
    max_results: 5,
  }).maybeSingle();

  // If we have a fuzzy function, use it; otherwise skip
  if (fuzzy) {
    return jsonResponse({
      resolved: true,
      entity: fuzzy,
      match_type: "fuzzy",
      match_confidence: fuzzy.similarity || 0.5,
    });
  }

  // 5. No match — return unresolved
  return jsonResponse({
    resolved: false,
    suggestion: "Use action='register' to create this entity",
    searched: { name, entity_type, iso3 },
  });
}

// ─── Register: create new canonical entity ──────────────────────────
async function registerEntity(supabase: any, params: any) {
  const { name, entity_type, display_name, iso3, lat, lon, metadata, aliases, external_ids } = params;
  if (!name || !entity_type) {
    return errorResponse(new Error("name and entity_type required"), 400);
  }

  // Create entity
  const { data: entity, error } = await supabase
    .from("canonical_entities")
    .insert({
      entity_type,
      canonical_name: name,
      display_name: display_name || name,
      iso3,
      lat,
      lon,
      metadata: metadata || {},
      trust_score: 0.5,
      source_count: 1,
      last_resolved_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return errorResponse(error);

  // Register aliases
  if (aliases && Array.isArray(aliases)) {
    const aliasRows = aliases.map((a: any) => ({
      entity_id: entity.id,
      alias: a.alias || a.name || a,
      alias_type: a.type || "name",
      source: a.source || "registration",
      confidence: a.confidence || 1.0,
    }));
    await supabase.from("entity_aliases").insert(aliasRows);
  }

  // Auto-register canonical name as alias
  await supabase.from("entity_aliases").upsert({
    entity_id: entity.id,
    alias: name,
    alias_type: "name",
    source: "canonical",
    confidence: 1.0,
  }, { onConflict: "entity_id,alias,alias_type" });

  // Register external IDs
  if (external_ids && Array.isArray(external_ids)) {
    const extRows = external_ids.map((e: any) => ({
      entity_id: entity.id,
      provider: e.provider,
      external_id: e.external_id,
      external_type: e.external_type,
      last_verified_at: new Date().toISOString(),
    }));
    await supabase.from("entity_external_ids").insert(extRows);
  }

  structuredLog("info", FN, `Registered entity: ${name} (${entity_type})`);
  return jsonResponse({ ok: true, entity });
}

// ─── Link: create relationship between entities ─────────────────────
async function linkEntities(supabase: any, params: any) {
  const { source_id, target_id, link_type, strength, source, metadata } = params;
  if (!source_id || !target_id || !link_type) {
    return errorResponse(new Error("source_id, target_id, link_type required"), 400);
  }

  const { data, error } = await supabase
    .from("entity_links")
    .insert({
      source_entity_id: source_id,
      target_entity_id: target_id,
      link_type,
      strength: strength || 1.0,
      source: source || "manual",
      metadata: metadata || {},
    })
    .select()
    .single();

  if (error) return errorResponse(error);
  return jsonResponse({ ok: true, link: data });
}

// ─── Merge: deduplicate two entities ────────────────────────────────
async function mergeEntities(supabase: any, params: any) {
  const { winner_id, loser_id, reason, confidence } = params;
  if (!winner_id || !loser_id || !reason) {
    return errorResponse(new Error("winner_id, loser_id, reason required"), 400);
  }

  // Move aliases from loser to winner
  await supabase
    .from("entity_aliases")
    .update({ entity_id: winner_id })
    .eq("entity_id", loser_id);

  // Move external IDs
  await supabase
    .from("entity_external_ids")
    .update({ entity_id: winner_id })
    .eq("entity_id", loser_id);

  // Move links (source side)
  await supabase
    .from("entity_links")
    .update({ source_entity_id: winner_id })
    .eq("source_entity_id", loser_id);

  // Move links (target side)
  await supabase
    .from("entity_links")
    .update({ target_entity_id: winner_id })
    .eq("target_entity_id", loser_id);

  // Increment source count on winner
  const { data: winner } = await supabase
    .from("canonical_entities")
    .select("source_count")
    .eq("id", winner_id)
    .single();

  await supabase
    .from("canonical_entities")
    .update({
      source_count: (winner?.source_count || 1) + 1,
      last_resolved_at: new Date().toISOString(),
    })
    .eq("id", winner_id);

  // Log the merge (immutable)
  await supabase.from("entity_merge_log").insert({
    winner_id,
    loser_id,
    merge_reason: reason,
    merged_by: "system",
    merge_confidence: confidence || 0.9,
  });

  // Delete the loser
  await supabase.from("canonical_entities").delete().eq("id", loser_id);

  structuredLog("info", FN, `Merged entity ${loser_id} → ${winner_id}`);
  return jsonResponse({ ok: true, winner_id, loser_id, merged: true });
}

// ─── Search: fuzzy search across entities ───────────────────────────
async function searchEntities(supabase: any, params: any) {
  const { query, entity_type, iso3, limit = 20 } = params;
  if (!query) return errorResponse(new Error("query required"), 400);

  let q = supabase
    .from("canonical_entities")
    .select("*, entity_aliases(alias, alias_type, confidence)")
    .ilike("canonical_name", `%${query}%`)
    .limit(limit);

  if (entity_type) q = q.eq("entity_type", entity_type);
  if (iso3) q = q.eq("iso3", iso3);

  const { data, error } = await q;
  if (error) return errorResponse(error);

  // Also search aliases
  const { data: aliasHits } = await supabase
    .from("entity_aliases")
    .select("entity_id, alias, confidence, canonical_entities(*)")
    .ilike("alias", `%${query}%`)
    .limit(limit);

  // Merge and deduplicate
  const seen = new Set(data?.map((e: any) => e.id) || []);
  const merged = [...(data || [])];

  for (const hit of aliasHits || []) {
    if (hit.canonical_entities && !seen.has(hit.canonical_entities.id)) {
      seen.add(hit.canonical_entities.id);
      merged.push({ ...hit.canonical_entities, _matched_alias: hit.alias });
    }
  }

  return jsonResponse({ results: merged, count: merged.length });
}

// ─── Graph: get entity with all relationships ───────────────────────
async function getEntityGraph(supabase: any, params: any) {
  const { entity_id, depth = 1 } = params;
  if (!entity_id) return errorResponse(new Error("entity_id required"), 400);

  const { data: entity } = await supabase
    .from("canonical_entities")
    .select("*")
    .eq("id", entity_id)
    .single();

  if (!entity) return errorResponse(new Error("Entity not found"), 404);

  const { data: aliases } = await supabase
    .from("entity_aliases")
    .select("*")
    .eq("entity_id", entity_id);

  const { data: externalIds } = await supabase
    .from("entity_external_ids")
    .select("*")
    .eq("entity_id", entity_id);

  const { data: outLinks } = await supabase
    .from("entity_links")
    .select("*, target:canonical_entities!entity_links_target_entity_id_fkey(id, canonical_name, entity_type, iso3)")
    .eq("source_entity_id", entity_id);

  const { data: inLinks } = await supabase
    .from("entity_links")
    .select("*, source:canonical_entities!entity_links_source_entity_id_fkey(id, canonical_name, entity_type, iso3)")
    .eq("target_entity_id", entity_id);

  return jsonResponse({
    entity,
    aliases: aliases || [],
    external_ids: externalIds || [],
    relationships: {
      outgoing: outLinks || [],
      incoming: inLinks || [],
    },
  });
}
