import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

// ─── Surface Registry ──────────────────────────────────────────────
// Maps URL resource → { view, default_order, filterable columns, default limit }
type SurfaceDef = {
  view: string;
  order_by: string;
  order_desc: boolean;
  filters: string[];           // exact-match filterable columns
  range_filters?: { col: string; gte_param?: string; lte_param?: string }[]; // time/value ranges
  default_limit: number;
  max_limit: number;
  /** Column used as the high-water mark for incremental sync. Required for /sync. */
  cursor_col?: string;
};

const SURFACES: Record<string, SurfaceDef> = {
  signals: {
    view: "quantivis_signals_feed",
    order_by: "period",
    order_desc: true,
    filters: ["iso3", "domain", "metric_name", "provider_name"],
    default_limit: 100,
    max_limit: 1000,
    cursor_col: "period",
  },
  entities: {
    view: "quantivis_entity_graph",
    order_by: "metric_count",
    order_desc: true,
    filters: ["entity_type", "iso3", "sovereignty_status"],
    default_limit: 100,
    max_limit: 1000,
    // No time column on this materialized aggregate — sync via offset pagination only.
  },
  countries: {
    view: "quantivis_country_dashboard",
    order_by: "iso3",
    order_desc: false,
    filters: ["iso3", "sovereignty_status", "is_reporting_entity"],
    default_limit: 50,
    max_limit: 250,
    cursor_col: "latest_data_at",
  },
  events: {
    view: "quantivis_event_feed",
    order_by: "event_date",
    order_desc: true,
    filters: ["event_type", "iso3", "severity", "provider_name"],
    range_filters: [{ col: "event_date", gte_param: "since", lte_param: "until" }],
    default_limit: 100,
    max_limit: 1000,
    cursor_col: "event_date",
  },
  predictions: {
    view: "quantivis_risk_predictions",
    order_by: "risk_probability",
    order_desc: true,
    filters: ["country_iso3", "domain"],
    default_limit: 100,
    max_limit: 500,
    cursor_col: "created_at",
  },
  cross_border: {
    view: "quantivis_cross_border_signals",
    order_by: "detected_at",
    order_desc: true,
    filters: ["origin_iso3", "domain", "signal_type"],
    range_filters: [{ col: "detected_at", gte_param: "since", lte_param: "until" }],
    default_limit: 100,
    max_limit: 1000,
    cursor_col: "detected_at",
  },
  cross_domain: {
    view: "quantivis_cross_domain_influence",
    order_by: "transfer_strength",
    order_desc: true,
    filters: ["source_domain", "target_domain", "region"],
    default_limit: 50,
    max_limit: 250,
    cursor_col: "computed_at",
  },
  recommendations: {
    view: "quantivis_recommended_actions",
    order_by: "generated_at",
    order_desc: true,
    filters: ["country_iso3", "domain", "intervention_type", "status"],
    range_filters: [{ col: "generated_at", gte_param: "since", lte_param: "until" }],
    default_limit: 50,
    max_limit: 250,
    cursor_col: "generated_at",
  },
  outcomes: {
    view: "quantivis_prediction_outcomes",
    order_by: "realized_at",
    order_desc: true,
    filters: ["country_iso3", "domain"],
    range_filters: [{ col: "realized_at", gte_param: "since", lte_param: "until" }],
    default_limit: 100,
    max_limit: 1000,
    cursor_col: "realized_at",
  },
  entity_links: {
    view: "quantivis_entity_links",
    order_by: "strength",
    order_desc: true,
    filters: ["link_type", "source_iso3", "target_iso3", "source_type", "target_type"],
    default_limit: 100,
    max_limit: 1000,
    cursor_col: "updated_at",
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return json({ error: "Missing x-api-key header" }, 401);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Validate API key
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(apiKey));
  const keyHash = Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");

  const { data: keyRow, error: keyErr } = await sb
    .from("api_keys")
    .select("id, org_id, revoked")
    .eq("key_hash", keyHash)
    .eq("revoked", false)
    .single();

  if (keyErr || !keyRow) {
    return json({ error: "Invalid or revoked API key" }, 403);
  }

  await sb.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id);

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const resource = pathParts[1] || "";

  try {
    // Catalog endpoint — discovery
    if (resource === "" || resource === "catalog") {
      return json({
        api: "Quantivis Bridge API",
        version: "2.0",
        surfaces: Object.entries(SURFACES).map(([key, def]) => ({
          path: `/${key}`,
          view: def.view,
          filters: def.filters,
          range_filters: def.range_filters?.map((r) => ({
            column: r.col,
            since_param: r.gte_param,
            until_param: r.lte_param,
          })) ?? [],
          default_limit: def.default_limit,
          max_limit: def.max_limit,
          pagination: "?limit=N&offset=M (use until/since for time-window paging on time-series surfaces)",
        })),
        stats_endpoint: "/stats",
        sync_endpoint: "/sync (status) or /sync/:surface (incremental pull, advances cursor)",
      });
    }

    if (resource === "stats") {
      const [metrics, entities, events, predictions, recs, outcomes, crossBorder, crossDomain, links] = await Promise.all([
        sb.from("normalized_metrics").select("id", { count: "exact", head: true }),
        sb.from("canonical_entities").select("id", { count: "exact", head: true }),
        sb.from("normalized_events").select("id", { count: "exact", head: true }),
        sb.from("quantivis_risk_predictions").select("id", { count: "exact", head: true }),
        sb.from("quantivis_recommended_actions").select("id", { count: "exact", head: true }),
        sb.from("quantivis_prediction_outcomes").select("id", { count: "exact", head: true }),
        sb.from("quantivis_cross_border_signals").select("id", { count: "exact", head: true }),
        sb.from("quantivis_cross_domain_influence").select("id", { count: "exact", head: true }),
        sb.from("entity_links").select("id", { count: "exact", head: true }),
      ]);
      return json({
        metrics: metrics.count || 0,
        entities: entities.count || 0,
        events: events.count || 0,
        risk_predictions_active: predictions.count || 0,
        recommended_actions_14d: recs.count || 0,
        prediction_outcomes_90d: outcomes.count || 0,
        cross_border_signals_30d: crossBorder.count || 0,
        cross_domain_influences_60d: crossDomain.count || 0,
        entity_links_total: links.count || 0,
        timestamp: new Date().toISOString(),
      });
    }

    // ─── Incremental sync ──────────────────────────────────────────
    // GET  /sync                  → status of all cursors for this org
    // GET  /sync/:surface         → fetch only rows newer than last cursor
    //   ?limit=N                  → max rows (capped by surface.max_limit)
    //   ?since=ISO                → override stored cursor (one-shot)
    //   ?until=ISO                → upper bound (defaults to now)
    //   ?dry_run=1                → don't advance cursor
    //   ?reset=1                  → reset cursor to epoch before fetching
    if (resource === "sync") {
      const syncSurface = pathParts[2];
      if (!syncSurface) {
        const { data: cursors } = await sb
          .from("quantivis_sync_cursors")
          .select("surface, last_synced_at, last_row_count, last_run_at")
          .eq("org_id", keyRow.org_id)
          .order("surface");
        return json({
          org_id: keyRow.org_id,
          cursors: cursors ?? [],
          syncable_surfaces: Object.entries(SURFACES)
            .filter(([, d]) => d.cursor_col)
            .map(([k, d]) => ({ surface: k, cursor_col: d.cursor_col })),
          usage: "GET /sync/:surface?limit=N[&since=ISO][&until=ISO][&dry_run=1][&reset=1]",
        });
      }

      const sdef = SURFACES[syncSurface];
      if (!sdef || !sdef.cursor_col) {
        return json({
          error: `Surface '${syncSurface}' is not syncable`,
          syncable: Object.entries(SURFACES).filter(([, d]) => d.cursor_col).map(([k]) => k),
        }, 400);
      }

      const reset = url.searchParams.get("reset") === "1";
      const dryRun = url.searchParams.get("dry_run") === "1";
      const overrideSince = url.searchParams.get("since");
      const until = url.searchParams.get("until") ?? new Date().toISOString();
      const syncLimit = Math.min(
        parseInt(url.searchParams.get("limit") || String(sdef.max_limit), 10) || sdef.max_limit,
        sdef.max_limit,
      );

      // Load (or create) cursor
      const { data: existing } = await sb
        .from("quantivis_sync_cursors")
        .select("last_synced_at")
        .eq("org_id", keyRow.org_id)
        .eq("surface", syncSurface)
        .maybeSingle();

      const since = overrideSince
        ?? (reset ? "1970-01-01T00:00:00Z" : (existing?.last_synced_at ?? "1970-01-01T00:00:00Z"));

      // Pull only rows in (since, until] ordered ascending by cursor for stable paging
      const { data, error: qErr } = await sb
        .from(sdef.view)
        .select("*")
        .gt(sdef.cursor_col, since)
        .lte(sdef.cursor_col, until)
        .order(sdef.cursor_col, { ascending: true, nullsFirst: false })
        .limit(syncLimit);

      if (qErr) throw qErr;

      const rows = data ?? [];
      const newHighWater = rows.length > 0
        ? String(rows[rows.length - 1][sdef.cursor_col!] ?? since)
        : since;

      const hasMore = rows.length === syncLimit;

      // Advance cursor unless dry-run
      if (!dryRun && rows.length > 0) {
        await sb.from("quantivis_sync_cursors").upsert(
          {
            org_id: keyRow.org_id,
            surface: syncSurface,
            last_synced_at: newHighWater,
            last_row_count: rows.length,
            last_run_at: new Date().toISOString(),
          },
          { onConflict: "org_id,surface" },
        );
      }

      return json({
        surface: syncSurface,
        view: sdef.view,
        cursor_col: sdef.cursor_col,
        since,
        until,
        new_high_water: newHighWater,
        row_count: rows.length,
        has_more: hasMore,
        next_call: hasMore
          ? `/sync/${syncSurface}?limit=${syncLimit}` + (overrideSince ? `&since=${newHighWater}` : "")
          : null,
        dry_run: dryRun,
        cursor_advanced: !dryRun && rows.length > 0,
        data: rows,
      });
    }

    const def = SURFACES[resource];
    if (!def) {
      return json({
        error: `Unknown resource '${resource}'`,
        available_surfaces: Object.keys(SURFACES),
        hint: "GET / or /catalog for full schema",
      }, 404);
    }

    // Pagination
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || String(def.default_limit), 10) || def.default_limit,
      def.max_limit,
    );
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

    // Build query
    let q = sb.from(def.view).select("*", { count: "exact" });

    // Exact-match filters
    for (const col of def.filters) {
      const v = url.searchParams.get(col);
      if (v !== null && v !== "") q = q.eq(col, v);
    }

    // Range filters (time windows)
    for (const rf of def.range_filters ?? []) {
      const since = rf.gte_param ? url.searchParams.get(rf.gte_param) : null;
      const until = rf.lte_param ? url.searchParams.get(rf.lte_param) : null;
      if (since) q = q.gte(rf.col, since);
      if (until) q = q.lte(rf.col, until);
    }

    // Order + paginate
    q = q.order(def.order_by, { ascending: !def.order_desc, nullsFirst: false });
    q = q.range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) throw error;

    return json({
      surface: resource,
      view: def.view,
      data: data ?? [],
      count: data?.length || 0,
      total: count ?? null,
      pagination: {
        limit,
        offset,
        next_offset: count != null && offset + limit < count ? offset + limit : null,
      },
      filters_applied: Object.fromEntries(
        [...def.filters, ...(def.range_filters?.flatMap((r) => [r.gte_param, r.lte_param].filter(Boolean) as string[]) ?? [])]
          .map((p) => [p, url.searchParams.get(p!)])
          .filter(([, v]) => v !== null),
      ),
    });
  } catch (e) {
    console.error("Quantivis bridge error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
