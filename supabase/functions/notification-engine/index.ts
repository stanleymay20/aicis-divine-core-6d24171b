import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface CriticalAlert {
  id: string;
  level: string | null;
  headline: string | null;
  country: string | null;
  event_type: string | null;
  severity: number | string | null;
  iso3: string | null;
  triggered_at: string;
}

interface DecisionRow { status: string | null; }
interface EventRow { category: string | null; }

interface NotificationInsert {
  user_id: null;
  type: "critical_alert";
  title: string;
  body: string;
  metadata: {
    alert_id: string;
    iso3: string | null;
    level: string | null;
    severity: number | string | null;
  };
  read: false;
  created_at: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const parsed = await req.json().catch(() => ({}));
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    const action = typeof body.action === "string" ? body.action : "process_queue";

    if (action === "process_queue") {
      const { data: alertData, error: alertError } = await supabase
        .from("critical_alerts")
        .select("id,level,headline,country,event_type,severity,iso3,triggered_at")
        .eq("acknowledged", false)
        .order("triggered_at", { ascending: false })
        .limit(50);
      if (alertError) throw alertError;

      const alerts = (alertData ?? []) as CriticalAlert[];
      if (alerts.length === 0) {
        return json({ ok: true, processed_alerts: 0, broadcasts_created: 0, authenticated_via: auth.via });
      }

      const notifications: NotificationInsert[] = [];
      let duplicatesSkipped = 0;
      for (const alert of alerts) {
        const { data: existing, error: existingError } = await supabase
          .from("user_notifications")
          .select("id")
          .eq("type", "critical_alert")
          .is("user_id", null)
          .contains("metadata", { alert_id: alert.id })
          .limit(1);
        if (existingError) throw existingError;
        if (existing && existing.length > 0) {
          duplicatesSkipped++;
          continue;
        }

        const level = alert.level ?? "alert";
        const headline = alert.headline ?? "Critical intelligence alert";
        const location = alert.country ?? alert.iso3 ?? "Global";
        const eventType = alert.event_type ?? "unspecified";
        const severity = alert.severity === null ? "not recorded" : String(alert.severity);

        notifications.push({
          user_id: null,
          type: "critical_alert",
          title: `[${level}] ${headline}`,
          body: `Location: ${location} | Event: ${eventType} | Recorded severity: ${severity}`,
          metadata: { alert_id: alert.id, iso3: alert.iso3, level: alert.level, severity: alert.severity },
          read: false,
          created_at: new Date().toISOString(),
        });
      }

      if (notifications.length > 0) {
        const { error: notificationError } = await supabase.from("user_notifications").insert(notifications);
        if (notificationError) throw notificationError;
      }

      await supabase.from("automation_logs").insert({
        job_name: "notification-engine",
        status: "success",
        message: `Reviewed ${alerts.length} unacknowledged alerts; created ${notifications.length} broadcast notifications; skipped ${duplicatesSkipped} existing broadcasts`,
      });

      return json({
        ok: true,
        processed_alerts: alerts.length,
        broadcasts_created: notifications.length,
        duplicates_skipped: duplicatesSkipped,
        delivery_scope: "in_app_broadcast",
        authenticated_via: auth.via,
      });
    }

    if (action === "send_digest") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [alertsResult, decisionsResult, eventsResult] = await Promise.all([
        supabase.from("critical_alerts").select("headline,level,country,severity,triggered_at").gte("triggered_at", since).order("severity", { ascending: false }),
        supabase.from("adi_decisions").select("status").gte("created_at", since),
        supabase.from("normalized_events").select("category").gte("occurred_at", since),
      ]);
      if (alertsResult.error) throw alertsResult.error;
      if (decisionsResult.error) throw decisionsResult.error;
      if (eventsResult.error) throw eventsResult.error;

      const alertRows = (alertsResult.data ?? []) as Array<Pick<CriticalAlert, "headline" | "level" | "country" | "severity" | "triggered_at">>;
      const decisionRows = (decisionsResult.data ?? []) as DecisionRow[];
      const eventRows = (eventsResult.data ?? []) as EventRow[];
      const byCategory = eventRows.reduce<Record<string, number>>((accumulator, event) => {
        const category = event.category ?? "uncategorized";
        accumulator[category] = (accumulator[category] ?? 0) + 1;
        return accumulator;
      }, {});

      const digest = {
        period: "24h",
        generated_at: new Date().toISOString(),
        alerts: {
          total: alertRows.length,
          critical: alertRows.filter((alert) => alert.level === "critical").length,
          high: alertRows.filter((alert) => alert.level === "high").length,
        },
        decisions: {
          total: decisionRows.length,
          approved: decisionRows.filter((decision) => decision.status === "approved").length,
          pending: decisionRows.filter((decision) => decision.status === "pending").length,
        },
        events: { total: eventRows.length, by_category: byCategory },
        top_alerts: alertRows.slice(0, 5).map((alert) => ({
          headline: alert.headline,
          level: alert.level,
          country: alert.country,
          recorded_severity: alert.severity,
          triggered_at: alert.triggered_at,
        })),
      };
      return json({ ok: true, digest, authenticated_via: auth.via });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error("Notification engine error:", error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
