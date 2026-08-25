import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";
import { startProviderRun, finishProviderRun, failProviderRun } from "../_shared/provider-telemetry.ts";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "fetch-security-global";
const TIMEOUT_MS = 15_000;

type KevRow = {
  cveID?: unknown;
  vulnerabilityName?: unknown;
  shortDescription?: unknown;
  vendorProject?: unknown;
  product?: unknown;
  dateAdded?: unknown;
  dueDate?: unknown;
  knownRansomwareCampaignUse?: unknown;
  requiredAction?: unknown;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const start = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const run = await startProviderRun(supabase, {
    provider_name: FN,
    endpoint: FN,
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
  });

  try {
    structuredLog("info", FN, "Starting security data collection");
    const results: { security: number; errors: string[] } = { security: 0, errors: [] };

    await resilientCall(`${FN}:cisa-kev`, async () => {
      const response = await fetch(
        "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
        {
          headers: {
            "User-Agent": "AICIS-Intelligence/1.0",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!response.ok) throw new Error(`CISA KEV: ${response.status}`);

      const payload = await response.json() as { vulnerabilities?: unknown };
      const rows = Array.isArray(payload.vulnerabilities)
        ? payload.vulnerabilities as KevRow[]
        : [];
      const cutoff = Date.now() - 30 * 86_400_000;

      const recent = rows.filter((row) => {
        const added = text(row.dateAdded);
        if (!added) return false;
        const timestamp = Date.parse(added);
        return Number.isFinite(timestamp) && timestamp >= cutoff;
      });

      const records = recent.flatMap((row) => {
        const cveId = text(row.cveID);
        if (!cveId) return [];
        const name = text(row.vulnerabilityName) ?? "Known exploited vulnerability";
        const description = text(row.shortDescription) ?? "";
        return [{
          source: "cisa_kev",
          event_type: "known_exploited_vulnerability",
          // KEV membership proves exploitation in the wild, not a universal CVSS
          // or impact grade. "high" communicates operational priority without
          // fabricating a numeric criticality score.
          severity: "high",
          title: cveId,
          description: `${name} — ${description}`.slice(0, 1000),
          cve_id: cveId,
          threat_score: null,
          metadata: {
            vendor: text(row.vendorProject),
            product: text(row.product),
            date_added: text(row.dateAdded),
            due_date: text(row.dueDate),
            ransomware_use: text(row.knownRansomwareCampaignUse),
            required_action: text(row.requiredAction),
            classification_basis: "cisa_known_exploited_vulnerabilities_catalog",
            numeric_threat_score: "not_inferred",
          },
        }];
      });

      if (records.length === 0) return;
      const { error } = await supabase.from("security_events").insert(records);
      if (error) throw new Error(`DB insert: ${error.message}`);
      results.security += records.length;
      structuredLog("info", FN, `CISA KEV: ${records.length} known-exploited CVEs`);
    }, { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => {
      const message = `CISA-KEV: ${messageOf(error)}`;
      results.errors.push(message);
      structuredLog("warn", FN, message);
    });

    // AbuseIPDB requires a concrete IP observed by AICIS telemetry. The former
    // implementation checked two hard-coded internet addresses every run and
    // presented those results as global security intelligence. That path is
    // intentionally disabled until a real observed-IP queue feeds the provider.
    structuredLog("info", FN, "AbuseIPDB skipped: no observed-IP candidate queue is configured");

    await supabase.from("automation_logs").insert({
      job_name: FN,
      status: results.errors.length === 0 ? "success" : results.security > 0 ? "partial" : "error",
      message: `Fetched ${results.security} security events. Errors: ${results.errors.length}${results.errors.length ? ` [${results.errors.join("; ")}]` : ""}`,
    });

    structuredLog("info", FN, `Complete: ${results.security} records, ${results.errors.length} errors`, undefined, start);
    await finishProviderRun(supabase, run, {
      records_inserted: results.security,
      records_normalized: results.security,
      error_count: results.errors.length,
      error_summary: results.errors[0] ?? null,
    });
    return jsonResponse({
      ok: true,
      message: `Fetched ${results.security} security events`,
      data: results,
    });
  } catch (error) {
    const message = messageOf(error);
    structuredLog("error", FN, message, undefined, start);
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message });
    await failProviderRun(supabase, run, error);
    return errorResponse(error);
  }
});
