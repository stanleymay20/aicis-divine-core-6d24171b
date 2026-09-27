import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_STATUSES = new Set(["pending", "in_progress", "blocked", "resolved", "stale", "cancelled"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const requestedStatuses = Array.isArray(body.statuses)
      ? body.statuses.map((value) => String(value).trim()).filter((value) => ALLOWED_STATUSES.has(value))
      : ["pending", "in_progress", "blocked"];
    const statuses = requestedStatuses.length
      ? [...new Set(requestedStatuses)]
      : ["pending", "in_progress", "blocked"];
    const auditHash = typeof body.strategic_audit_hash === "string"
      ? body.strategic_audit_hash.trim().toLowerCase()
      : "";
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 200);

    let query = sb
      .from("strategic_research_runs_v1")
      .select([
        "id",
        "strategic_audit_hash",
        "planner_version",
        "workflow_version",
        "action_id",
        "action_kind",
        "title",
        "priority",
        "workflow_status",
        "lifecycle_status",
        "source_candidate_id",
        "action_snapshot",
        "action_snapshot_hash",
        "evidence_refs",
        "resolution",
        "started_at",
        "resolved_at",
        "stale_at",
        "created_at",
        "updated_at",
      ].join(","))
      .eq("user_id", user.id)
      .in("lifecycle_status", statuses)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (auditHash) {
      if (!/^[a-f0-9]{64}$/.test(auditHash)) {
        return json({ ok: false, error: "strategic_audit_hash must be a SHA-256 hex digest" }, 400);
      }
      query = query.eq("strategic_audit_hash", auditHash);
    }

    const { data, error } = await query;
    if (error && (error as { code?: string }).code === "PGRST205") {
      // Storage for research runs is not provisioned in the live database.
      // Report the gap explicitly instead of failing the whole page.
      return json({
        ok: true,
        available: false,
        statuses,
        strategic_audit_hash: auditHash || null,
        run_count: 0,
        runs: [],
        scope_notice: "Research run tracking is not yet provisioned; no runs can be listed.",
      });
    }
    if (error) throw error;

    return json({
      ok: true,
      available: true,
      statuses,
      strategic_audit_hash: auditHash || null,
      run_count: data?.length ?? 0,
      runs: data ?? [],
      scope_notice: "Only research runs owned by the authenticated user are returned under row-level security.",
    });
  } catch (error) {
    console.error("list-strategic-research-runs failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Strategic research run listing failed",
      runs: [],
    }, 500);
  }
});
