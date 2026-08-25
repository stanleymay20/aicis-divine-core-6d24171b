import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type EventMetadata = Record<string, unknown>;

type NormalizedSecurityEvent = {
  provider_name: string | null;
  event_type: string | null;
  title: string | null;
  description: string | null;
  iso3: string | null;
  country_iso3: string | null;
  source_name: string | null;
  source_url: string | null;
  occurred_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  severity: number | null;
  confidence: number | null;
  dedup_key: string | null;
  metadata: EventMetadata | null;
  last_verified_at: string | null;
};

const asNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asInteger = (value: unknown): number | null => {
  const parsed = asNumber(value);
  return parsed == null ? null : Math.max(0, Math.round(parsed));
};

const normalizedSeverity = (provider: string | null, value: number | null): number | null => {
  if (value == null) return null;
  const scaled = provider === "acled" && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, scaled));
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("normalized_events")
      .select("provider_name,event_type,title,description,iso3,country_iso3,source_name,source_url,occurred_at,started_at,ended_at,severity,confidence,dedup_key,metadata,last_verified_at")
      .in("provider_name", ["acled", "ucdp"])
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(2000);

    if (error) throw error;

    let mirrored = 0;
    let skipped = 0;

    for (const row of (data ?? []) as NormalizedSecurityEvent[]) {
      if (!row.dedup_key || !row.title) {
        skipped += 1;
        continue;
      }

      const metadata = row.metadata ?? {};
      const provider = row.provider_name ?? "event_provider";
      const country = typeof metadata.country_name === "string"
        ? metadata.country_name
        : row.country_iso3 ?? row.iso3;
      const iso3 = row.country_iso3 ?? row.iso3;
      const killed = asInteger(metadata.fatalities);
      const lat = asNumber(metadata.latitude);
      const lon = asNumber(metadata.longitude);
      const admin1 = typeof metadata.admin1 === "string"
        ? metadata.admin1
        : typeof metadata.adm_1 === "string"
          ? metadata.adm_1
          : null;
      const admin2 = typeof metadata.admin2 === "string"
        ? metadata.admin2
        : typeof metadata.adm_2 === "string"
          ? metadata.adm_2
          : null;

      const incident = {
        source: provider,
        source_id: row.dedup_key,
        title: row.title,
        summary: row.description,
        event_type: row.event_type ?? "conflict_event",
        severity: normalizedSeverity(provider, row.severity),
        killed,
        injured: null,
        displaced: null,
        start_time: row.started_at ?? row.occurred_at,
        end_time: row.ended_at,
        country,
        iso3,
        admin1,
        admin2,
        lat,
        lon,
        url: row.source_url,
        raw: {
          provenance: "normalized_events",
          provider,
          provider_dedup_key: row.dedup_key,
          confidence: row.confidence,
          last_verified_at: row.last_verified_at,
          metadata,
        },
        dedupe_key: `normalized:${row.dedup_key}`,
      };

      const { error: upsertError } = await supabase
        .from("security_incidents")
        .upsert(incident, { onConflict: "dedupe_key", ignoreDuplicates: false });

      if (upsertError) {
        console.error("security incident mirror failed", row.dedup_key, upsertError.message);
        skipped += 1;
      } else {
        mirrored += 1;
      }
    }

    await supabase.from("automation_logs").insert({
      job_name: "fetch-security-incidents",
      status: skipped === 0 ? "success" : "partial",
      message: `Mirrored ${mirrored} event-grade ACLED/UCDP records; skipped=${skipped}`,
    });

    return new Response(JSON.stringify({
      ok: true,
      source_policy: "event_grade_only",
      providers: ["acled", "ucdp"],
      mirrored,
      skipped,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("fetch-security-incidents error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
