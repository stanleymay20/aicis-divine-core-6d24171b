import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
// Hierarchical Entity-Link Builder v2
// For each admin region in the batch:
//   1. Ensure a canonical_entities row exists (entity_type='territory'), keyed by metadata.region_id
//   2. admin_level=1 → entity_link country (member_of) territory
//   3. has parent_id → entity_link parent_territory (parent) child_territory
// All upserts are idempotent. Real rows are inserted into entity_links so the graph is queryable.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH = 500;

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const cursorKey = "hierarchical_links_cursor";
    const { data: cur } = await supabase
      .from("backfill_state").select("value_int").eq("key", cursorKey).maybeSingle();
    const offset = cur?.value_int ?? 0;

    const { data: regions, error } = await supabase
      .from("admin_regions")
      .select("id, country_iso3, admin_level, parent_id, name")
      .order("id")
      .range(offset, offset + BATCH - 1);
    if (error) throw error;

    if (!regions || regions.length === 0) {
      await supabase.from("backfill_state").upsert(
        { key: cursorKey, value_int: 0, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
      return new Response(JSON.stringify({ ok: true, message: "wrapped cursor" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Country canonical entity lookup
    const isoSet = Array.from(new Set(regions.map((r) => r.country_iso3).filter(Boolean)));
    const { data: countryEntities } = await supabase
      .from("canonical_entities").select("id, iso3")
      .eq("entity_type", "country").in("iso3", isoSet);
    const isoToCountry = new Map<string, string>(
      (countryEntities ?? []).map((c: any) => [c.iso3, c.id]),
    );

    // 2. Lookup existing territory entities for this batch + their parents (by metadata.region_id)
    const allRegionIds = Array.from(new Set([
      ...regions.map((r) => r.id),
      ...regions.map((r) => r.parent_id).filter(Boolean),
    ]));

    const { data: existingTerritories } = await supabase
      .from("canonical_entities")
      .select("id, metadata")
      .eq("entity_type", "territory")
      .in("metadata->>region_id", allRegionIds);
    const regionToEntity = new Map<string, string>(
      (existingTerritories ?? []).map((e: any) => [e.metadata?.region_id, e.id]),
    );

    // 3. Upsert territories for missing region_ids — dedupe by canonical_name to avoid
    // "ON CONFLICT DO UPDATE command cannot affect row a second time" (PG 21000) when two
    // admin regions share the same name within a batch.
    const territorySeen = new Set<string>();
    const toUpsertTerritories = regions
      .filter((r) => !regionToEntity.has(r.id))
      .map((r) => ({
        entity_type: "territory" as const,
        canonical_name: `${r.name} (${r.country_iso3} L${r.admin_level})`,
        display_name: r.name,
        iso3: r.country_iso3,
        metadata: { region_id: r.id, admin_level: r.admin_level, parent_id: r.parent_id ?? null, country_iso3: r.country_iso3, source: "admin_regions" },
      } as any))
      .filter((t) => {
        const key = `${t.entity_type}|${t.canonical_name.toLowerCase()}`;
        if (territorySeen.has(key)) return false;
        territorySeen.add(key);
        return true;
      });

    let createdEntities = 0;
    if (toUpsertTerritories.length > 0) {
      const { data: ins, error: insErr } = await supabase
        .from("canonical_entities")
        .upsert(toUpsertTerritories, { onConflict: "entity_type,normalized_name", ignoreDuplicates: false })
        .select("id, metadata");
      if (insErr) throw insErr;
      createdEntities = ins?.length ?? 0;
      for (const e of ins ?? []) regionToEntity.set((e as any).metadata?.region_id, (e as any).id);
    }

    // 4. Build links
    const links: any[] = [];
    for (const r of regions) {
      const tId = regionToEntity.get(r.id);
      if (!tId) continue;

      if (r.admin_level === 1) {
        const cId = isoToCountry.get(r.country_iso3);
        if (cId && cId !== tId) {
          links.push({
            source_entity_id: cId, target_entity_id: tId,
            link_type: "member_of", strength: 1.0,
            source: "hierarchical-link-builder",
            metadata: { kind: "country->admin1", region_name: r.name },
            provenance_source: "admin_regions.country_iso3", provenance_confidence: 1.0,
          });
        }
      }

      if (r.parent_id) {
        const pId = regionToEntity.get(r.parent_id);
        if (pId && pId !== tId) {
          links.push({
            source_entity_id: pId, target_entity_id: tId,
            link_type: "parent", strength: 1.0,
            source: "hierarchical-link-builder",
            metadata: { kind: `admin${r.admin_level - 1}->admin${r.admin_level}`, region_name: r.name },
            provenance_source: "admin_regions.parent_id", provenance_confidence: 1.0,
          });
        }
      }
    }

    // Dedupe links within the batch on the conflict key to avoid PG 21000.
    const linkSeen = new Set<string>();
    const dedupedLinks = links.filter((l) => {
      const key = `${l.source_entity_id}|${l.target_entity_id}|${l.link_type}`;
      if (linkSeen.has(key)) return false;
      linkSeen.add(key);
      return true;
    });

    let insertedLinks = 0;
    if (dedupedLinks.length > 0) {
      const { data: linkIns, error: linkErr } = await supabase
        .from("entity_links")
        .upsert(dedupedLinks, { onConflict: "source_entity_id,target_entity_id,link_type", ignoreDuplicates: true })
        .select("id");
      if (linkErr) throw linkErr;
      insertedLinks = linkIns?.length ?? 0;
    }

    await supabase.from("backfill_state").upsert(
      { key: cursorKey, value_int: offset + regions.length, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

    await supabase.from("automation_logs").insert({
      job_name: "hierarchical-link-builder", status: "success",
      message: `offset=${offset} processed=${regions.length} new_entities=${createdEntities} new_links=${insertedLinks}`,
    });

    return new Response(JSON.stringify({
      ok: true, offset, processed: regions.length,
      created_entities: createdEntities, inserted_links: insertedLinks,
      duration_ms: Date.now() - start,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : (typeof e === "object" ? JSON.stringify(e) : String(e));
    console.error("hierarchical-link-builder error:", msg);
    await supabase.from("automation_logs").insert({
      job_name: "hierarchical-link-builder", status: "error", message: msg.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
