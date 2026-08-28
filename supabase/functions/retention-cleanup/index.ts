// Policy-driven retention cleanup — canonical hardened implementation.
//
// Deletes occur only for explicit auto_cleanup policies and a fixed table allowlist.
// Audit logs are never deleted. Unknown categories and invalid retention windows fail
// closed. This worker does not infer the next schedule and does not mix retention with
// unrelated dataset lifecycle mutations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const CATEGORY_TABLE_MAP: Record<string, { table: string; dateColumn: string }[]> = {
  datasets: [{ table: "datasets", dateColumn: "created_at" }],
  decisions: [{ table: "decision_ledger", dateColumn: "created_at" }],
  advisories: [{ table: "advisory_instances", dateColumn: "created_at" }],
  copilot_messages: [
    { table: "copilot_messages", dateColumn: "created_at" },
    { table: "copilot_sessions", dateColumn: "updated_at" },
  ],
  session_data: [],
};

type RetentionPolicy = {
  id: string;
  organization_id: string;
  data_category: string;
  retention_days: number;
  auto_cleanup: boolean;
};

type PolicyResult = {
  policy_id: string;
  organization_id: string;
  data_category: string;
  retention_days: number;
  status: "enforced" | "skipped" | "failed";
  deleted: number;
  errors: string[];
  semantics: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data, error } = await supabase
      .from("data_retention_policies")
      .select("id,organization_id,data_category,retention_days,auto_cleanup")
      .eq("auto_cleanup", true)
      .limit(1000);
    if (error) throw error;

    const policies = (data ?? []) as RetentionPolicy[];
    const results: PolicyResult[] = [];

    for (const policy of policies) {
      const targets = CATEGORY_TABLE_MAP[policy.data_category];
      const validDays = Number.isInteger(policy.retention_days) && policy.retention_days >= 1;

      if (!validDays) {
        results.push({
          policy_id: policy.id,
          organization_id: policy.organization_id,
          data_category: policy.data_category,
          retention_days: policy.retention_days,
          status: "failed",
          deleted: 0,
          errors: ["invalid_retention_days"],
          semantics: "policy_not_enforced_invalid_retention_window",
        });
        continue;
      }

      if (!targets) {
        results.push({
          policy_id: policy.id,
          organization_id: policy.organization_id,
          data_category: policy.data_category,
          retention_days: policy.retention_days,
          status: "failed",
          deleted: 0,
          errors: ["unsupported_data_category"],
          semantics: "policy_not_enforced_category_not_allowlisted",
        });
        continue;
      }

      if (targets.length === 0) {
        results.push({
          policy_id: policy.id,
          organization_id: policy.organization_id,
          data_category: policy.data_category,
          retention_days: policy.retention_days,
          status: "skipped",
          deleted: 0,
          errors: [],
          semantics: "category_has_no_canonical_cleanup_target",
        });
        continue;
      }

      const cutoff = new Date(Date.now() - policy.retention_days * 86_400_000).toISOString();
      let deleted = 0;
      const errors: string[] = [];

      for (const target of targets) {
        const { data: deletedRows, error: deleteError } = await supabase
          .from(target.table)
          .delete()
          .eq("organization_id", policy.organization_id)
          .lt(target.dateColumn, cutoff)
          .select("id");

        if (deleteError) {
          errors.push(`${target.table}:${deleteError.message}`);
          continue;
        }
        deleted += deletedRows?.length ?? 0;
      }

      if (errors.length === 0) {
        const { error: statusError } = await supabase
          .from("data_retention_policies")
          .update({
            enforcement_status: "enforced",
            last_cleanup_at: new Date().toISOString(),
          })
          .eq("id", policy.id);
        if (statusError) errors.push(`policy_status:${statusError.message}`);
      }

      results.push({
        policy_id: policy.id,
        organization_id: policy.organization_id,
        data_category: policy.data_category,
        retention_days: policy.retention_days,
        status: errors.length === 0 ? "enforced" : "failed",
        deleted,
        errors,
        semantics: errors.length === 0
          ? "explicit_policy_allowlisted_age_based_deletion"
          : "partial_or_failed_policy_enforcement_not_reported_as_success",
      });
    }

    const failed = results.filter((result) => result.status === "failed").length;
    const enforced = results.filter((result) => result.status === "enforced").length;
    const skipped = results.filter((result) => result.status === "skipped").length;
    const deleted = results.reduce((sum, result) => sum + result.deleted, 0);

    return new Response(JSON.stringify({
      ok: failed === 0,
      policies_total: policies.length,
      policies_enforced: enforced,
      policies_skipped: skipped,
      policies_failed: failed,
      rows_deleted: deleted,
      results,
      retention_semantics: "explicit_policy_allowlist_no_inferred_schedule",
      next_scheduled_at: null,
      authenticated_via: auth.via,
    }), {
      status: failed === 0 ? 200 : 207,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("retention-cleanup error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
