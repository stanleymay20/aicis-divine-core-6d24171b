// Executes an export run: pulls filtered signals, compresses, validates,
// writes file to aicis-exports bucket, updates run row, triggers webhooks.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";
import {
  corsHeaders, normalizeSignal, compressSignals, validateExport,
  applyProfileFilters, rowsToCsv, sha256Hex, buildEnvelope, ExportProfile,
} from "../_shared/export-schema.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function buildRecsMap(countries: string[]) {
  const map = new Map<string, string[]>();
  if (!countries.length) return map;
  const { data } = await admin
    .from("risk_action_recommendations")
    .select("country_iso3, domain, action_summary, intervention_type, urgency_window")
    .in("country_iso3", countries).limit(2000);
  for (const r of data ?? []) {
    const key = `${(r.country_iso3 ?? "").toUpperCase()}::${r.domain ?? ""}`;
    const text = `[${r.urgency_window ?? "n/a"}] ${r.intervention_type ?? ""}: ${r.action_summary ?? ""}`.trim();
    if (!map.has(key)) map.set(key, []);
    if (map.get(key)!.length < 5) map.get(key)!.push(text);
  }
  return map;
}

async function execRun(runId: string) {
  const start = Date.now();
  await admin.from("export_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", runId);
  const { data: run } = await admin.from("export_runs").select("*").eq("id", runId).single();
  if (!run) throw new Error("run_not_found");
  const { data: profile } = await admin.from("export_profiles").select("*").eq("id", run.profile_id).single();
  if (!profile) throw new Error("profile_not_found");
  const prof = profile as ExportProfile;

  // Pull cursor
  const { data: cur } = await admin.from("export_cursor_state").select("*").eq("profile_id", prof.id).maybeSingle();

  let q = admin.from("global_signals").select(
    "id,title,summary,category,confidence_score,impact_score,urgency_score,trend_direction,affected_countries,affected_regions,affected_sectors,affected_entities,primary_source,canonical_source_name,source_trust_tier,ingestion_source,merged_source_count,source_rank_score,official_source_present,evidence_hash,first_detected_at,latest_update_at,why_it_matters,source_urls,recommended_actions",
  );
  q = applyProfileFilters(q, prof);
  if (cur?.last_signal_updated_at) q = q.gte("latest_update_at", cur.last_signal_updated_at);
  q = q.order("latest_update_at", { ascending: false }).order("id", { ascending: false }).limit(prof.max_records_per_run);

  const { data: rows, error } = await q;
  if (error) throw new Error(`query: ${error.message}`);
  const raw = rows ?? [];
  const countries = Array.from(new Set(raw.flatMap((r: any) => r.affected_countries ?? []).filter(Boolean).map((c: string) => c.toUpperCase())));
  const recsMap = await buildRecsMap(countries);
  const signals = raw.map((r: any) => normalizeSignal(r, prof, recsMap));
  const { signals: postSignals, clusters } = compressSignals(signals, { prefer_clusters: prof.prefer_clusters });
  const issues = validateExport(postSignals);
  const finalData = prof.prefer_clusters ? postSignals : signals;

  const envelope = buildEnvelope(finalData, {
    schema_version: prof.schema_version,
    export_batch_id: run.export_batch_id,
    meta: { profile_id: prof.id, profile_name: prof.name, clusters, validation_issues: issues.slice(0, 50) },
  });

  // Serialize
  const fmt = run.format as "json" | "csv" | "ndjson";
  let payload: string; let mime: string; let ext: string;
  if (fmt === "csv") {
    const cols = ["signal_id","title","summary","domain","country","region","severity","confidence_score","relevance_score","urgency_score","impact_score","trend_direction","created_at","updated_at"];
    payload = rowsToCsv(cols, finalData); mime = "text/csv"; ext = "csv";
  } else if (fmt === "ndjson") {
    payload = finalData.map((r) => JSON.stringify(r)).join("\n") + (finalData.length ? "\n" : "");
    mime = "application/x-ndjson"; ext = "ndjson";
  } else {
    payload = JSON.stringify(envelope, null, 2); mime = "application/json"; ext = "json";
  }

  let bytes = new TextEncoder().encode(payload);
  const rawSize = bytes.byteLength;
  let storedExt = ext; let storedMime = mime;
  if (bytes.byteLength > 1_000_000) {
    bytes = gzip(bytes); storedExt = `${ext}.gz`; storedMime = "application/gzip";
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `runs/${run.id}-${ts}.${storedExt}`;
  const { error: upErr } = await admin.storage.from("aicis-exports").upload(path, bytes, { contentType: storedMime, upsert: true });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const duration = Date.now() - start;
  await admin.from("export_runs").update({
    status: "success",
    records_selected: raw.length,
    records_exported: finalData.length,
    clusters_exported: clusters.length,
    recommendations_exported: Array.from(recsMap.values()).reduce((a, b) => a + b.length, 0),
    duration_ms: duration,
    payload_size_bytes: bytes.byteLength,
    storage_path: path,
    finished_at: new Date().toISOString(),
    cursor_end: { last_updated_at: raw[0]?.latest_update_at ?? null, raw_size_bytes: rawSize },
  }).eq("id", run.id);

  // Update cursor
  if (raw.length) {
    await admin.from("export_cursor_state").upsert({
      profile_id: prof.id,
      last_signal_updated_at: raw[0].latest_update_at,
      last_signal_id: raw[0].id,
      updated_at: new Date().toISOString(),
    });
  }
  await admin.from("export_profiles").update({ last_run_at: new Date().toISOString() }).eq("id", prof.id);

  // Trigger webhooks (fire-and-forget)
  admin.functions.invoke("exports-webhook-dispatcher", { body: { run_id: run.id } }).catch(() => {});

  return { ok: true, run_id: run.id, records: finalData.length, clusters: clusters.length, bytes: bytes.byteLength };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const runId = body.run_id;
    if (!runId) return new Response(JSON.stringify({ error: "run_id_required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const result = await execRun(runId);
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("exports-runner", msg);
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.run_id) {
        await admin.from("export_runs").update({ status: "error", error: msg, finished_at: new Date().toISOString() }).eq("id", body.run_id);
      }
    } catch (_) {}
    return new Response(JSON.stringify({ error: "internal", detail: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
