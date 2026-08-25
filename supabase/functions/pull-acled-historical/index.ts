// ACLED historical conflict-event backfill. One year per invocation.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const FN = "pull-acled-historical";

type AcledEvent = Record<string, unknown> & {
  data_id?: unknown; event_id_cnty?: unknown; event_date?: unknown; fatalities?: unknown;
  event_type?: unknown; country?: unknown; iso3?: unknown; latitude?: unknown; longitude?: unknown;
  notes?: unknown; location?: unknown; sub_event_type?: unknown; actor1?: unknown; actor2?: unknown;
  admin1?: unknown; admin2?: unknown; year?: unknown;
};

type AcledPage = { success?: boolean; data?: unknown; error?: { message?: unknown } };
type AcledToken = { access_token?: unknown };

type HistoricalRow = {
  dedup_key: string; provider_name: string; event_type: string; category: string;
  title: string; description: string | null; iso3: string | null; country_iso3: string | null;
  source_name: string; source_url: string; occurred_at: string; started_at: string; ended_at: string;
  severity: null; confidence: null; provenance_source: string; last_verified_at: string;
  metadata: Record<string, unknown>;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const numberValue = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const iso3Value = (value: unknown): string | null => {
  const candidate = text(value)?.toUpperCase() ?? "";
  return /^[A-Z]{3}$/.test(candidate) ? candidate : null;
};

async function getAcledToken(email: string, password: string): Promise<string> {
  const form = new URLSearchParams({ username: email, password, grant_type: "password", client_id: "acled" });
  const response = await fetch("https://acleddata.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`ACLED OAuth HTTP ${response.status}`);
  const payload = await response.json() as AcledToken;
  const token = text(payload.access_token);
  if (!token) throw new Error("ACLED OAuth returned no access token");
  return token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireAdminOrCron(req, cors);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const email = Deno.env.get("ACLED_EMAIL");
  const password = Deno.env.get("ACLED_PASSWORD");
  if (!email || !password) {
    await supabase.from("automation_logs").insert({
      job_name: FN, status: "warning", message: "ACLED credentials missing; historical backfill skipped.",
    });
    return json({ ok: true, skipped: true, reason: "missing_credentials" });
  }

  const started = Date.now();
  try {
    const { data: state, error: stateError } = await supabase
      .from("automation_logs").select("message").eq("job_name", FN).eq("status", "success")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (stateError) throw stateError;

    let nextYear = 1997;
    const match = typeof state?.message === "string" ? state.message.match(/year=(\d{4})/) : null;
    if (match) nextYear = Number(match[1]) + 1;
    const currentYear = new Date().getUTCFullYear();
    if (nextYear > currentYear) {
      await supabase.from("automation_logs").insert({
        job_name: FN, status: "success", message: `ACLED backfill complete. year=${currentYear}`,
      });
      return json({ ok: true, done: true, year: currentYear });
    }

    const token = await getAcledToken(email, password);
    let inserted = 0;
    let page = 1;
    const pageSize = 5000;

    while (page <= 100 && Date.now() - started < 50_000) {
      const response = await fetch(
        `https://acleddata.com/api/acled/read?_format=json&limit=${pageSize}&page=${page}&year=${nextYear}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(40_000) },
      );
      if (!response.ok) throw new Error(`ACLED HTTP ${response.status}`);
      const payload = await response.json() as AcledPage;
      if (payload.success === false) throw new Error(text(payload.error?.message) ?? "ACLED success=false");
      const events = Array.isArray(payload.data) ? payload.data as AcledEvent[] : [];
      if (events.length === 0) break;

      const observedAt = new Date().toISOString();
      const rows: HistoricalRow[] = events.flatMap((event) => {
        const id = text(event.data_id) ?? text(event.event_id_cnty);
        const eventDate = text(event.event_date);
        const country = text(event.country);
        if (!id || !eventDate || !country) return [];
        const occurredAt = new Date(eventDate).toISOString();
        const eventType = (text(event.event_type) ?? "conflict").toLowerCase().replace(/\s+/g, "_");
        const fatalities = numberValue(event.fatalities);
        const iso3 = iso3Value(event.iso3);
        return [{
          dedup_key: `acled:${id}`,
          provider_name: "acled",
          event_type: eventType,
          category: "conflict",
          title: `${text(event.event_type) ?? "Conflict event"} in ${country}`,
          description: text(event.notes),
          iso3,
          country_iso3: iso3,
          source_name: "ACLED",
          source_url: "https://acleddata.com",
          occurred_at: occurredAt,
          started_at: occurredAt,
          ended_at: occurredAt,
          severity: null,
          confidence: null,
          provenance_source: "ACLED",
          last_verified_at: observedAt,
          metadata: {
            fatalities,
            latitude: numberValue(event.latitude),
            longitude: numberValue(event.longitude),
            location: text(event.location),
            country_name: country,
            sub_event_type: text(event.sub_event_type),
            actor1: text(event.actor1), actor2: text(event.actor2),
            admin1: text(event.admin1), admin2: text(event.admin2),
            year: numberValue(event.year) ?? nextYear,
            severity_policy: "not_inferred_from_fatalities",
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
      message: `ACLED year=${nextYear}: ${inserted} events ingested in ${Date.now() - started}ms`,
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
