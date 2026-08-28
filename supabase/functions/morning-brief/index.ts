import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_RUNTIME_MS = 45_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rotateDaily<T>(rows: T[], observedAtMs: number): T[] {
  if (rows.length < 2) return rows;
  const offset = Math.floor(observedAtMs / DAY_MS) % rows.length;
  return [...rows.slice(offset), ...rows.slice(0, offset)];
}

async function listAllUserEmails(
  supabase: ReturnType<typeof createClient>,
): Promise<Map<string, string>> {
  const emailByUserId = new Map<string, string>();
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    for (const user of users) {
      if (user.email) emailByUserId.set(user.id, user.email);
    }
    if (users.length < perPage) break;
    page += 1;
  }

  return emailByUserId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const resendKey = Deno.env.get("RESEND_API_KEY") ?? null;
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? null;
  const appBaseUrlRaw = Deno.env.get("APP_BASE_URL") ?? null;
  let appBaseUrl: string | null = null;
  if (appBaseUrlRaw) {
    try {
      const parsed = new URL(appBaseUrlRaw);
      if (parsed.protocol === "https:") appBaseUrl = parsed.origin;
    } catch {
      appBaseUrl = null;
    }
  }

  // Email delivery is withheld rather than silently using a stale provider/domain.
  if (!resendKey || !fromEmail) {
    return new Response(JSON.stringify({
      success: false,
      delivery_status: "withheld_missing_delivery_configuration",
      missing: [
        !resendKey ? "RESEND_API_KEY" : null,
        !fromEmail ? "RESEND_FROM_EMAIL" : null,
      ].filter(Boolean),
      authenticated_via: auth.via,
      schedule_semantics: "scheduler activation remains blocked until the exact live source schedule is recovered",
    }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const deadline = startedAt + MAX_RUNTIME_MS;

  try {
    const { data: orgs, error: orgError } = await supabase
      .from("organizations")
      .select("id,name");
    if (orgError) throw orgError;

    if (!orgs?.length) {
      return new Response(JSON.stringify({
        success: true,
        delivery_status: "no_organizations",
        sent: 0,
        authenticated_via: auth.via,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const emailByUserId = await listAllUserEmails(supabase);
    const rotatedOrgs = rotateDaily(orgs, startedAt);

    let sent = 0;
    let failed = 0;
    let orgsProcessed = 0;
    let orgsWithReportableItems = 0;
    const deliveryErrors: Array<{ organization_id: string; reason: string }> = [];

    for (const org of rotatedOrgs) {
      if (Date.now() >= deadline) break;
      orgsProcessed += 1;

      const [pendingResult, advisoryResult, signalResult] = await Promise.all([
        supabase
          .from("decision_ledger")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .eq("execution_status", "not_started"),
        supabase
          .from("advisory_instances")
          .select("id,title,priority")
          .eq("organization_id", org.id)
          .eq("status", "open")
          .in("priority", ["critical", "high"])
          .limit(5),
        supabase
          .from("insights")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .eq("is_read", false)
          .eq("severity", "high"),
      ]);

      const readErrors = [pendingResult.error, advisoryResult.error, signalResult.error].filter(Boolean);
      if (readErrors.length > 0) {
        failed += 1;
        deliveryErrors.push({
          organization_id: org.id,
          reason: "brief_source_query_failed",
        });
        continue;
      }

      const decisionsAwaiting = pendingResult.count ?? 0;
      const highSeverityUnreadSignals = signalResult.count ?? 0;
      const advisories = advisoryResult.data ?? [];

      if (decisionsAwaiting === 0 && highSeverityUnreadSignals === 0 && advisories.length === 0) {
        continue;
      }
      orgsWithReportableItems += 1;

      const { data: members, error: memberError } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", org.id)
        .in("role", ["owner", "admin", "executive"]);

      if (memberError) {
        failed += 1;
        deliveryErrors.push({ organization_id: org.id, reason: "recipient_query_failed" });
        continue;
      }

      const recipients = [...new Set(
        (members ?? [])
          .map((member) => emailByUserId.get(member.user_id))
          .filter((email): email is string => Boolean(email)),
      )];
      if (recipients.length === 0) continue;

      const priorityLabel = highSeverityUnreadSignals > 0
        ? "High-severity signals present"
        : advisories.some((row) => row.priority === "critical")
        ? "Critical advisory present"
        : "Items awaiting review";

      const subjectParts: string[] = [];
      if (decisionsAwaiting > 0) subjectParts.push(`${decisionsAwaiting} decision${decisionsAwaiting === 1 ? "" : "s"} awaiting review`);
      if (highSeverityUnreadSignals > 0) subjectParts.push(`${highSeverityUnreadSignals} unread high-severity signal${highSeverityUnreadSignals === 1 ? "" : "s"}`);
      if (advisories.length > 0) subjectParts.push(`${advisories.length} high/critical advisor${advisories.length === 1 ? "y" : "ies"}`);
      const subject = `AICIS Morning Brief — ${subjectParts.join(" · ")}`;

      const advisoryRows = advisories.map((advisory) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">
            <strong>${escapeHtml(advisory.priority)}</strong> — ${escapeHtml(advisory.title)}
          </td>
        </tr>`).join("");

      const cta = appBaseUrl
        ? `<p style="text-align:center;margin:28px 0;"><a href="${escapeHtml(appBaseUrl)}" style="display:inline-block;padding:12px 28px;background:#111827;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Open AICIS</a></p>`
        : "";

      const html = `<!doctype html>
<html><body style="margin:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;padding:32px 20px;">
<tr><td>
  <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1.4px;">AICIS · Morning Brief</div>
  <h2 style="margin:12px 0 4px;">${escapeHtml(org.name)}</h2>
  <p style="margin:0 0 22px;color:#4b5563;">${escapeHtml(priorityLabel)}</p>
  <table width="100%" cellpadding="8" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
    <tr><td><strong>Decisions awaiting review</strong></td><td align="right">${decisionsAwaiting}</td></tr>
    <tr><td><strong>Unread high-severity signals</strong></td><td align="right">${highSeverityUnreadSignals}</td></tr>
    <tr><td><strong>Open high/critical advisories</strong></td><td align="right">${advisories.length}</td></tr>
  </table>
  ${advisoryRows ? `<h3 style="margin-top:24px;">Open advisories</h3><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;">${advisoryRows}</table>` : ""}
  ${cta}
  <p style="font-size:11px;color:#9ca3af;margin-top:28px;border-top:1px solid #f3f4f6;padding-top:14px;">Counts are direct database observations from the brief run. No calibration probability or inferred confidence is presented.</p>
</td></tr></table>
</body></html>`;

      const utcDay = new Date(startedAt).toISOString().slice(0, 10);
      for (const email of recipients) {
        if (Date.now() >= deadline) break;
        try {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": `aicis-morning-brief/${utcDay}/${org.id}/${email.toLowerCase()}`,
            },
            body: JSON.stringify({
              from: `AICIS Intelligence <${fromEmail}>`,
              to: [email],
              subject,
              html,
            }),
          });
          await response.text();
          if (!response.ok) {
            failed += 1;
            deliveryErrors.push({ organization_id: org.id, reason: `email_provider_http_${response.status}` });
            continue;
          }
          sent += 1;
        } catch {
          failed += 1;
          deliveryErrors.push({ organization_id: org.id, reason: "email_provider_request_failed" });
        }
      }
    }

    const truncated = orgsProcessed < rotatedOrgs.length;
    return new Response(JSON.stringify({
      success: failed === 0 && !truncated,
      delivery_status: failed > 0 ? "partial_failure" : truncated ? "runtime_budget_exhausted" : "completed",
      sent,
      failed,
      orgs_processed: orgsProcessed,
      orgs_total: rotatedOrgs.length,
      orgs_with_reportable_items: orgsWithReportableItems,
      truncated,
      errors: deliveryErrors.slice(0, 25),
      authenticated_via: auth.via,
      evidence_semantics: "counts_are_direct_database_observations; no calibrated probability or analytical confidence asserted",
      schedule_semantics: "scheduler activation remains blocked until the exact live source schedule is recovered",
    }), {
      status: failed > 0 ? 207 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      authenticated_via: auth.via,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
