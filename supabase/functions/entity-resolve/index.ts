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

// ─── Resolve: hardened priority order ────────────────────────────────
// 1. External ID exact → 2. Canonical normalized exact → 3. Alias exact → 4. Fuzzy → 5. Unresolved
async function resolveEntity(supabase: any, params: any) {
  const { name, entity_type, iso3, external_ids } = params;
  if (!name || !entity_type) {
    return errorResponse(new Error("name and entity_type required"), 400);
  }

  // 1. External ID match FIRST (strongest signal)
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
          match_confidence: 1.0,
          matched_provider: ext.provider,
        });
      }
    }
  }

  const normalizedName = name.toLowerCase().trim();

  // 2. Canonical normalized exact match
  const { data: exact } = await supabase
    .from("canonical_entities")
    .select("*")
    .eq("entity_type", entity_type)
    .eq("normalized_name", normalizedName)
    .limit(1)
    .maybeSingle();

  if (exact) {
    return jsonResponse({ resolved: true, entity: exact, match_type: "exact", match_confidence: 1.0 });
  }

  // 3. Alias exact match
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

  // 4. Fuzzy match using ranked trigram similarity
  const { data: fuzzyResults } = await supabase.rpc("similarity_search_entities", {
    search_name: name,
    search_type: entity_type,
    min_similarity: 0.3,
    max_results: 5,
  });

  if (fuzzyResults && fuzzyResults.length > 0) {
    const best = fuzzyResults[0];
    return jsonResponse({
      resolved: true,
      entity: best,
      match_type: "fuzzy",
      match_confidence: best.similarity || 0.5,
      match_source: best.match_source,
      alternatives: fuzzyResults.length > 1 ? fuzzyResults.slice(1) : [],
    });
  }

  // 5. Unresolved
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

  const { data: entity, error } = await supabase
    .from("canonical_entities")
    .insert({
      entity_type,
      canonical_name: name,
      display_name: display_name || name,
      iso3, lat, lon,
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

// ─── Link: create relationship with provenance ──────────────────────
async function linkEntities(supabase: any, params: any) {
  const { source_id, target_id, link_type, strength, source, metadata, provenance_source, provenance_confidence } = params;
  if (!source_id || !target_id || !link_type) {
    return errorResponse(new Error("source_id, target_id, link_type required"), 400);
  }
  if (source_id === target_id) {
    return errorResponse(new Error("Cannot link entity to itself"), 400);
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
      provenance_source: provenance_source || source || "manual",
      provenance_confidence: provenance_confidence || 1.0,
      provenance_observed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return errorResponse(error);
  return jsonResponse({ ok: true, link: data });
}

// ─── Merge: transactional via DB function ───────────────────────────
async function mergeEntities(supabase: any, params: any) {
  const { winner_id, loser_id, reason, confidence } = params;
  if (!winner_id || !loser_id || !reason) {
    return errorResponse(new Error("winner_id, loser_id, reason required"), 400);
  }

  const { data, error } = await supabase.rpc("merge_entities_tx", {
    _winner_id: winner_id,
    _loser_id: loser_id,
    _reason: reason,
    _confidence: confidence || 0.9,
    _merged_by: "system",
  });

  if (error) return errorResponse(error);
  structuredLog("info", FN, `Merged entity ${loser_id} → ${winner_id}`);
  return jsonResponse(data);
}

// ─── Search: ranked with trigram scoring ────────────────────────────
async function searchEntities(supabase: any, params: any) {
  const { query, entity_type, iso3, limit = 20 } = params;
  if (!query) return errorResponse(new Error("query required"), 400);

  // Use ranked fuzzy search
  const { data: ranked } = await supabase.rpc("similarity_search_entities", {
    search_name: query,
    search_type: entity_type || null,
    min_similarity: 0.2,
    max_results: limit,
  });

  let results = ranked || [];

  // Also do substring fallback for short queries
  if (results.length < 3) {
    let q = supabase
      .from("canonical_entities")
      .select("*")
      .ilike("canonical_name", `%${query}%`)
      .limit(limit);
    if (entity_type) q = q.eq("entity_type", entity_type);
    if (iso3) q = q.eq("iso3", iso3);
    const { data: substringHits } = await q;

    const seen = new Set(results.map((r: any) => r.id));
    for (const hit of substringHits || []) {
      if (!seen.has(hit.id)) {
        seen.add(hit.id);
        results.push({ ...hit, similarity: 0.1, match_source: "substring" });
      }
    }
  }

  return jsonResponse({ results, count: results.length });
}

// ─── Graph: real depth traversal ────────────────────────────────────
async function getEntityGraph(supabase: any, params: any) {
  const { entity_id, depth = 1 } = params;
  if (!entity_id) return errorResponse(new Error("entity_id required"), 400);

  const { data: entity } = await supabase
    .from("canonical_entities")
    .select("*")
    .eq("id", entity_id)
    .single();

  if (!entity) return errorResponse(new Error("Entity not found"), 404);

  // Parallel fetch: aliases, external IDs, and graph traversal
  const [aliasRes, extRes, graphRes] = await Promise.all([
    supabase.from("entity_aliases").select("*").eq("entity_id", entity_id),
    supabase.from("entity_external_ids").select("*").eq("entity_id", entity_id),
    supabase.rpc("traverse_entity_graph", { _entity_id: entity_id, _depth: depth }),
  ]);

  const edges = graphRes.data || [];
  const outgoing = edges.filter((e: any) => e.direction === "outgoing");
  const incoming = edges.filter((e: any) => e.direction === "incoming");

  return jsonResponse({
    entity,
    aliases: aliasRes.data || [],
    external_ids: extRes.data || [],
    relationships: { outgoing, incoming },
    graph_depth: depth,
    total_connections: edges.length,
  });
}
