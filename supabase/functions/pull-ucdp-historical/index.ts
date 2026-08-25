// UCDP Georeferenced Event Dataset historical backfill. One year per invocation.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const FN = "pull-ucdp-historical";
const UCDP_VERSION = "25.1";

type UcdpEvent = Record<string, unknown> & {
  id?: unknown; country_id?: unknown; date_start?: unknown; date_end?: unknown; best?: unknown;
  type_of_violence?: unknown; side_a?: unknown; side_b?: unknown; country?: unknown; adm_1?: unknown;
  adm_2?: unknown; where_coordinates?: unknown; source_article?: unknown; source_original?: unknown;
  conflict_new_id?: unknown; dyad_new_id?: unknown; region?: unknown; latitude?: unknown;
  longitude?: unknown; deaths_civilians?: unknown;
};
type UcdpPayload = { Result?: unknown };

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const numberValue = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireAdminOrCron(req, cors);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const started = Date.now();
  const token = Deno.env.get("UCDP_ACCESS_TOKEN");

  try {
    if (!token) {
      await supabase.from("automation_logs").insert({
        job_name: FN, status: "skipped", message: "UCDP_ACCESS_TOKEN not configured; historical backfill skipped.",
      });
      return json({ ok: true, skipped: true, reason: "missing_token" });
    }

    const { data: state, error: stateError } = await supabase
      .from("automation_logs").select("message").eq("job_name", FN).eq("status", "success")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (stateError) throw stateError;

    let nextYear = 1989;
    const match = typeof state?.message === "string" ? state.message.match(/year=(\d{4})/) : null;
    if (match) nextYear = Number(match[1]) + 1;
    const lastCompleteYear = new Date().getUTCFullYear() - 1;
    if (nextYear > lastCompleteYear) {
      await supabase.from("automation_logs").insert({
        job_name: FN, status: "success", message: `UCDP backfill complete. year=${lastCompleteYear}`,
      });
      return json({ ok: true, done: true, year: lastCompleteYear });
    }

    let inserted = 0;
    let page = 1;
    const pageSize = 1000;
    while (page <= 50 && Date.now() - started < 50_000) {
      const response = await fetch(
        `https://ucdpapi.pcr.uu.se/api/gedevents/${UCDP_VERSION}?pagesize=${pageSize}&page=${page}&StartDate=${nextYear}-01-01&EndDate=${nextYear}-12-31`,
        { signal: AbortSignal.timeout(40_000), headers: { "x-ucdp-access-token": token } },
      );
      if (response.status === 404) break;
      if (!response.ok) throw new Error(`UCDP HTTP ${response.status}`);
      const payload = await response.json() as UcdpPayload;
      const events = Array.isArray(payload.Result) ? payload.Result as UcdpEvent[] : [];
      if (events.length === 0) break;

      const verifiedAt = new Date().toISOString();
      const rows = events.flatMap((event) => {
        const id = text(event.id) ?? (numberValue(event.id) != null ? String(numberValue(event.id)) : null);
        const dateStart = text(event.date_start);
        const country = text(event.country);
        if (!id || !dateStart || !country) return [];
        const occurredAt = new Date(dateStart).toISOString();
        const endedAt = text(event.date_end) ? new Date(String(event.date_end)).toISOString() : occurredAt;
        const violenceType = numberValue(event.type_of_violence);
        const eventType = violenceType === 1 ? "state_based_conflict"
          : violenceType === 2 ? "non_state_conflict" : "one_sided_violence";
        const fatalities = numberValue(event.best);
        const fatalityText = fatalities == null ? "fatalities unavailable" : `${fatalities} reported fatalities`;
        return [{
          dedup_key: `ucdp:ged:${UCDP_VERSION}:${id}`,
          provider_name: "ucdp",
          event_type: eventType,
          category: "conflict",
          title: `${text(event.side_a) ?? "Unknown"} vs ${text(event.side_b) ?? "Unknown"} — ${country}`,
          description: `${fatalityText} in ${text(event.adm_1) ?? country}.`,
          iso3: null,
          country_iso3: null,
          source_name: "UCDP GED",
          source_url: "https://ucdp.uu.se/encyclopedia",
          occurred_at: occurredAt,
          started_at: occurredAt,
          ended_at: endedAt,
          severity: null,
          confidence: null,
          provenance_source: `UCDP GED v${UCDP_VERSION}`,
          last_verified_at: verifiedAt,
          metadata: {
            conflict_id: numberValue(event.conflict_new_id), dyad_id: numberValue(event.dyad_new_id),
            country_name: country, country_id: numberValue(event.country_id), region: text(event.region),
            adm_1: text(event.adm_1), adm_2: text(event.adm_2),
            where_coordinates: text(event.where_coordinates), latitude: numberValue(event.latitude),
            longitude: numberValue(event.longitude), fatalities,
            deaths_civilians: numberValue(event.deaths_civilians),
            source_article: text(event.source_article), source_original: text(event.source_original),
            year: nextYear, severity_policy: "not_inferred_from_fatalities",
          },
        }];
      });

      for (let index = 0; index < rows.length; index += 500) {
        const chunk = rows.slice(index, index + 500);
        const { error } = await supabase.from("normalized_events").upsert(chunk, {
          onConflict: "dedup_key", ignoreDuplicates: true,
        });
        if (error) throw error;
        inserted += chunk.length;
      }
      if (events.length < pageSize) break;
      page += 1;
    }

    await supabase.from("automation_logs").insert({
      job_name: FN, status: "success",
      message: `UCDP year=${nextYear}: ${inserted} events ingested in ${Date.now() - started}ms`,
    });
    return json({ ok: true, year: nextYear, inserted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("automation_logs").insert({ job_name: FN, status: "error", message: message.slice(0, 500) });
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
