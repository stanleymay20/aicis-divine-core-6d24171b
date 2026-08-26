import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_STATUSES = new Set(["proposed", "accepted", "dismissed", "executed"]);
const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  proposed: new Set(["accepted", "dismissed"]),
  accepted: new Set(["executed", "dismissed"]),
  dismissed: new Set(["proposed"]),
  executed: new Set(),
};

type UnknownRecord = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const { ctx, response } = await requireUser(req, corsHeaders);
  if (response || !ctx) return response ?? json({ ok: false, error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceKey);

  const bodyUnknown: unknown = await req.json().catch(() => ({}));
  const body = isRecord(bodyUnknown) ? bodyUnknown : {};
  const mode = asText(body.mode, 32) ?? "list";

  try {
    if (mode === "list") {
      const limit = boundedInteger(body.limit, 50, 200);
      const status = asText(body.status, 32);
      const country = asText(body.country_iso3, 3)?.toUpperCase() ?? null;
      const domain = asText(body.domain, 64)?.toLowerCase() ?? null;

      let query = userClient
        .from("risk_action_recommendations")
        .select("*")
        .order("rank_position", { ascending: true, nullsFirst: false })
        .limit(limit);

      if (status && ALLOWED_STATUSES.has(status)) query = query.eq("status", status);
      if (country) query = query.eq("country_iso3", country);
      if (domain) query = query.eq("domain", domain);

      if (body.all_batches !== true) {
        const { data: latest, error: latestError } = await userClient
          .from("risk_action_recommendations")
          .select("batch_id,generated_at")
          .order("generated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestError) throw latestError;
        const latestBatch = isRecord(latest) ? asText(latest.batch_id, 64) : null;
        if (latestBatch) query = query.eq("batch_id", latestBatch);
      }

      const { data, error } = await query;
      if (error) throw error;
      const first = Array.isArray(data) && isRecord(data[0]) ? data[0] : null;

      return json({
        ok: true,
        rows: data ?? [],
        generated_at: first ? asText(first.generated_at, 64) : null,
      });
    }

    if (mode === "generate") {
      const topN = boundedInteger(body.top_n, 50, 200);
      const { data, error } = await adminClient.rpc(
        "generate_risk_action_recommendations",
        { p_top_n: topN },
      );
      if (error) throw error;

      const statsUnknown = Array.isArray(data) ? data[0] : data;
      const stats = isRecord(statsUnknown) ? statsUnknown : {};
      const batchId = asText(stats.batch_id, 64);
      let rows: UnknownRecord[] = [];

      if (batchId) {
        const { data: generatedRows, error: rowsError } = await userClient
          .from("risk_action_recommendations")
          .select("*")
          .eq("batch_id", batchId)
          .order("rank_position", { ascending: true, nullsFirst: false });
        if (rowsError) throw rowsError;
        rows = Array.isArray(generatedRows)
          ? generatedRows.filter(isRecord)
          : [];
      }

      return json({
        ok: true,
        batch_id: batchId,
        generated: Number(stats.generated) || 0,
        rows,
        epistemic_note:
          "Actions are review candidates. Financial economics and intervention effects are not estimated unless separately evidence-backed.",
      });
    }

    if (mode === "update") {
      const id = asText(body.id, 64);
      const nextStatus = asText(body.status, 32);
      const notes = asText(body.outcome_notes_md, 4_000);

      if (!id || !nextStatus || !ALLOWED_STATUSES.has(nextStatus)) {
        return json({ ok: false, error: "Invalid id or status" }, 400);
      }

      const { data: current, error: currentError } = await userClient
        .from("risk_action_recommendations")
        .select("id,status")
        .eq("id", id)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!isRecord(current)) return json({ ok: false, error: "Recommendation not found" }, 404);

      const currentStatus = asText(current.status, 32) ?? "";
      const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? new Set<string>();
      if (!allowed.has(nextStatus)) {
        return json(
          {
            ok: false,
            error: "Invalid lifecycle transition",
            from: currentStatus,
            to: nextStatus,
          },
          409,
        );
      }

      const now = new Date().toISOString();
      const patch: UnknownRecord = {
        status: nextStatus,
        last_status_changed_by: ctx.user.id,
        last_status_changed_at: now,
      };
      if (nextStatus === "accepted") {
        patch.accepted_by = ctx.user.id;
        patch.accepted_at = now;
      }
      if (nextStatus === "executed") patch.executed_at = now;
      if (nextStatus === "proposed") {
        patch.accepted_by = null;
        patch.accepted_at = null;
        patch.executed_at = null;
      }
      if (notes) patch.outcome_notes_md = notes;

      const { data: updated, error: updateError } = await adminClient
        .from("risk_action_recommendations")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (updateError) throw updateError;

      return json({ ok: true, recommendation: updated });
    }

    return json({ ok: false, error: `Unknown mode: ${mode}` }, 400);
  } catch (error) {
    console.error("[generate-risk-actions] error:", error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});
