import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SEVERITY_ORDER: Record<string, number> = { info: 0, warning: 1, error: 2, critical: 3 };
const MAX_EVENTS_PER_RUN = 200;
const MAX_FORWARD_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 15_000;

interface QueueEvent {
  id: string;
  event_type: string;
  severity: string;
  payload: unknown;
  created_at: string;
  forward_attempts: number | null;
}

interface SiemConfig {
  destination: string;
  endpoint_url: string;
  auth_header: string | null;
  min_severity: string | null;
  filter_event_types: string[] | null;
}

interface EventDeliveryResult {
  event_id: string;
  matched_destinations: number;
  delivered_destinations: number;
  forwarded: boolean;
  errors: string[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function matchesConfig(event: QueueEvent, config: SiemConfig): boolean {
  const minimum = SEVERITY_ORDER[config.min_severity ?? "warning"] ?? SEVERITY_ORDER.warning;
  const eventLevel = SEVERITY_ORDER[event.severity] ?? SEVERITY_ORDER.info;
  if (eventLevel < minimum) return false;
  if (config.filter_event_types?.length && !config.filter_event_types.includes(event.event_type)) return false;
  return true;
}

function validateDestinationUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`unsupported_protocol:${url.protocol}`);
  }
  return url;
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

    const { data: pendingData, error: pendingError } = await supabase
      .from("siem_forward_queue")
      .select("id,event_type,severity,payload,created_at,forward_attempts")
      .eq("forwarded", false)
      .lt("forward_attempts", MAX_FORWARD_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(MAX_EVENTS_PER_RUN);
    if (pendingError) throw pendingError;

    const pending = (pendingData ?? []) as QueueEvent[];
    if (pending.length === 0) {
      return json({ ok: true, forwarded: 0, attempted_events: 0, message: "no pending events", authenticated_via: auth.via });
    }

    const { data: configData, error: configError } = await supabase
      .from("siem_forward_config")
      .select("destination,endpoint_url,auth_header,min_severity,filter_event_types")
      .eq("enabled", true);
    if (configError) throw configError;

    const configs = (configData ?? []) as SiemConfig[];
    if (configs.length === 0) {
      await supabase.from("automation_logs").insert({
        job_name: "siem-forward",
        status: "warning",
        message: `Retained ${pending.length} queued SIEM events because no active destination is configured`,
      });
      return json({
        ok: true,
        forwarded: 0,
        attempted_events: 0,
        retained: pending.length,
        message: "no destinations configured; queue retained",
        authenticated_via: auth.via,
      });
    }

    const eventResults: EventDeliveryResult[] = [];
    for (const event of pending) {
      const matched = configs.filter((config) => matchesConfig(event, config));
      if (matched.length === 0) {
        const { error: updateError } = await supabase
          .from("siem_forward_queue")
          .update({ last_error: "no_matching_destination" })
          .eq("id", event.id);
        if (updateError) throw updateError;
        eventResults.push({ event_id: event.id, matched_destinations: 0, delivered_destinations: 0, forwarded: false, errors: [] });
        continue;
      }

      const perEventErrors: string[] = [];
      let deliveredDestinations = 0;
      for (const config of matched) {
        try {
          const endpoint = validateDestinationUrl(config.endpoint_url);
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (config.auth_header) headers.Authorization = config.auth_header;
          const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
              source: "aicis",
              event_type: event.event_type,
              severity: event.severity,
              timestamp: event.created_at,
              payload: event.payload,
            }),
            signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
          });
          if (response.ok) deliveredDestinations++;
          else perEventErrors.push(`${config.destination}:http_${response.status}`);
        } catch (error) {
          perEventErrors.push(`${config.destination}:${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const allMatchedDelivered = deliveredDestinations === matched.length && perEventErrors.length === 0;
      const attempts = Number(event.forward_attempts ?? 0) + 1;
      const { error: updateError } = await supabase
        .from("siem_forward_queue")
        .update({
          forwarded: allMatchedDelivered,
          forwarded_at: allMatchedDelivered ? new Date().toISOString() : null,
          forward_attempts: attempts,
          last_error: allMatchedDelivered ? null : perEventErrors.slice(0, 3).join("; "),
        })
        .eq("id", event.id);
      if (updateError) throw updateError;

      eventResults.push({
        event_id: event.id,
        matched_destinations: matched.length,
        delivered_destinations: deliveredDestinations,
        forwarded: allMatchedDelivered,
        errors: perEventErrors,
      });
    }

    const forwarded = eventResults.filter((result) => result.forwarded).length;
    const retained = eventResults.length - forwarded;
    const deliveryErrors = eventResults.flatMap((result) => result.errors);
    await supabase.from("automation_logs").insert({
      job_name: "siem-forward",
      status: deliveryErrors.length === 0 ? "success" : (forwarded > 0 ? "partial" : "error"),
      message: `SIEM queue processed=${eventResults.length} forwarded=${forwarded} retained=${retained} delivery_errors=${deliveryErrors.length}`,
    });

    return json({
      ok: deliveryErrors.length === 0,
      forwarded,
      retained,
      processed_events: eventResults.length,
      active_destinations: configs.length,
      delivery_errors: deliveryErrors.slice(0, 5),
      results: eventResults,
      authenticated_via: auth.via,
    });
  } catch (error) {
    console.error("siem-forward error:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
