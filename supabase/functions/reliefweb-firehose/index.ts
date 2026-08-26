/**
 * reliefweb-firehose — pulls the ReliefWeb (UN OCHA) reports API and
 * ingests humanitarian disasters/crises into global_signals.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordFirehoseHealth, shouldSkipForBackoff } from "../_shared/firehose-health.ts";
import { startProviderRun, finishProviderRun } from "../_shared/provider-telemetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const FN = "reliefweb-firehose";
const APPROVED_APPNAME = "AICIS-global-risk-intelligence-q4m81";
const APPNAME = Deno.env.get("RELIEFWEB_APPNAME_APPROVED") ?? APPROVED_APPNAME;

type RunStatus = "SUCCESS" | "SUCCESS_WITH_FALLBACK" | "WARNING_EMPTY_RESPONSE" | "FAILED";
type ReliefCountry = { iso3?: string | null; name?: string | null };
type ReliefFields = {
  title?: string | null;
  url?: string | null;
  date?: { created?: string | null } | null;
  country?: ReliefCountry[] | null;
  primary_country?: ReliefCountry | null;
};
type ReliefItem = { id?: string | number | null; fields?: ReliefFields | null };
type ApiResult = { items: ReliefItem[]; httpStatus: number; latencyMs: number; error: string | null };
type ProviderRunHistory = {
  records_inserted: number | null;
  params: Record<string, unknown> | null;
  status: string | null;
  completed_at: string | null;
};
type Candidate = {
  title: string;
  link: string;
  domain: string;
  occurredAt: string | null;
  iso3s: string[];
  category: string;
  dedup: string;
};

function normalizeDedup(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 10).join(" ");
}

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseProviderTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function fetchOfficialApi(): Promise<ApiResult> {
  const url = `https://api.reliefweb.int/v2/reports?appname=${encodeURIComponent(APPNAME)}`;
  const body = {
    limit: 200,
    sort: ["date.created:desc"],
    fields: { include: ["title", "url", "date.created", "country.iso3", "country.name", "primary_country.iso3"] },
  };
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": `${APPNAME}/1.0 (https://aicis.io; ops@aicis.io)`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { items: [], httpStatus: res.status, latencyMs, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const parsed = await res.json() as { data?: ReliefItem[] };
    return { items: parsed.data ?? [], httpStatus: res.status, latencyMs, error: null };
  } catch (error) {
    return { items: [], httpStatus: 0, latencyMs: Date.now() - t0, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchRssFallback(): Promise<ApiResult> {
  const feeds = [
    "https://reliefweb.int/updates/rss.xml",
    "https://reliefweb.int/disasters/rss.xml",
    "https://api.allorigins.win/raw?url=https%3A%2F%2Freliefweb.int%2Fupdates%2Frss.xml",
  ];
  const userAgents = [
    "Mozilla/5.0 (compatible; AICIS/1.0; +https://aicis.io)",
    `${APPNAME}/1.0 (https://aicis.io; ops@aicis.io)`,
  ];
  const t0 = Date.now();
  let lastErr: string | null = null;
  let lastStatus = 0;

  for (const feed of feeds) {
    for (const userAgent of userAgents) {
      try {
        const res = await fetch(feed, {
          headers: {
            "User-Agent": userAgent,
            Accept: "application/rss+xml, application/xml, text/xml, */*",
            "Accept-Encoding": "identity",
          },
        });
        lastStatus = res.status;
        if (!res.ok) {
          lastErr = `rss HTTP ${res.status} (${feed})`;
          continue;
        }
        const xml = await res.text();
        const blocks = xml.split(/<item[\s>]/i).slice(1);
        const parsed: ReliefItem[] = [];
        for (const block of blocks) {
          const pick = (tag: string): string | null => {
            const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
            if (!match) return null;
            return match[1]
              .replace(/<!\[CDATA\[|\]\]>/g, "")
              .replace(/<[^>]+>/g, "")
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
              .trim();
          };
          const title = pick("title");
          if (!title) continue;
          const link = pick("link");
          const created = parseProviderTimestamp(pick("pubDate"));
          parsed.push({ id: link, fields: { title, url: link, date: { created }, country: [] } });
        }
        if (parsed.length > 0) return { items: parsed, httpStatus: 200, latencyMs: Date.now() - t0, error: null };
        lastErr = `rss empty body (${feed}, ${xml.length} bytes)`;
      } catch (error) {
        lastErr = `${feed}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }
  return { items: [], httpStatus: lastStatus, latencyMs: Date.now() - t0, error: lastErr };
}

async function evaluateHealth(
  supabase: ReturnType<typeof createClient>,
  current: { rowsWritten: number; fallbackUsed: boolean; status: RunStatus },
) {
  const warnings: string[] = [];
  try {
    const { data: runRows } = await supabase
      .from("provider_runs")
      .select("records_inserted,params,status,completed_at")
      .eq("endpoint", FN)
      .order("started_at", { ascending: false })
      .limit(10);
    const history = (runRows ?? []) as ProviderRunHistory[];

    const zeroStreak = history.slice(0, 3);
    if (zeroStreak.length === 3 && zeroStreak.every((run) => (run.records_inserted ?? 0) === 0) && current.rowsWritten === 0) {
      warnings.push("rows_written = 0 for 3 consecutive runs");
    }
    if (current.status === "WARNING_EMPTY_RESPONSE") warnings.push("ReliefWeb returned an empty result set");
    const fallbackStreak = history.slice(0, 5).filter((run) => run.params?.fallback_used === true).length;
    if (current.fallbackUsed && fallbackStreak >= 5) warnings.push("RSS fallback used for more than 5 consecutive runs — official API lane degraded");
    const lastOk = history.find((run) => run.status === "completed" && run.completed_at);
    if (!lastOk || !lastOk.completed_at || Date.now() - new Date(lastOk.completed_at).getTime() > 3_600_000) {
      if (current.status === "FAILED") warnings.push("No successful ReliefWeb ingestion in the last hour");
    }

    if (warnings.length > 0) {
      await supabase.from("automation_logs").insert({
        job_name: `${FN}-health`, status: "warning", message: warnings.join(" | "),
      });
    }
  } catch (error) {
    console.warn("[reliefweb] health evaluation failed", error instanceof Error ? error.message : String(error));
  }
  return warnings;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const start = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const guard = await shouldSkipForBackoff(supabase, FN);
  if (guard.skip) {
    return new Response(JSON.stringify({ ok: true, skipped: true, next_retry_at: guard.nextRetryAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const run = await startProviderRun(supabase, {
    provider_name: "reliefweb",
    endpoint: FN,
    scheduler_source: req.headers.get("x-scheduler-source") ?? "manual",
    params: { appname: APPNAME },
  });

  const { count: rowsBefore } = await supabase
    .from("global_signals").select("id", { count: "exact", head: true }).eq("ingestion_source", "reliefweb_firehose");

  const api = await fetchOfficialApi();
  let items = api.items;
  let fallbackUsed = false;
  let fallback: ApiResult | null = null;

  if (items.length === 0) {
    console.warn(`[reliefweb] api lane empty (status=${api.httpStatus} err=${api.error}) → RSS fallback`);
    fallback = await fetchRssFallback();
    if (fallback.items.length > 0) {
      items = fallback.items;
      fallbackUsed = true;
    }
  }

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const fields = item.fields ?? {};
    const title = fields.title;
    if (!title) continue;
    const domain = "reliefweb.int";
    const dedup = `${normalizeDedup(title)}::${domain}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const iso3s: string[] = [];
    for (const country of fields.country ?? []) {
      if (country.iso3) iso3s.push(country.iso3.toUpperCase());
    }
    const primaryIso3 = fields.primary_country?.iso3?.toUpperCase();
    if (primaryIso3 && !iso3s.includes(primaryIso3)) iso3s.unshift(primaryIso3);
    const occurredAt = parseProviderTimestamp(fields.date?.created);
    const link = fields.url ?? `https://reliefweb.int/report/${item.id ?? "unknown"}`;

    let category = "migration_displacement";
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes("flood") || lowerTitle.includes("storm") || lowerTitle.includes("earthquake") || lowerTitle.includes("cyclone")) category = "climate_disaster";
    else if (lowerTitle.includes("conflict") || lowerTitle.includes("violence") || lowerTitle.includes("attack")) category = "defense_conflict";
    else if (lowerTitle.includes("cholera") || lowerTitle.includes("outbreak") || lowerTitle.includes("epidemic")) category = "public_health";
    else if (lowerTitle.includes("food") || lowerTitle.includes("famine") || lowerTitle.includes("hunger")) category = "food_agriculture";

    candidates.push({ title, link, domain, occurredAt, iso3s, category, dedup });
  }

  let existing = new Set<string>();
  if (candidates.length > 0) {
    const { data } = await supabase.from("global_signals").select("dedup_key").in("dedup_key", candidates.map((candidate) => candidate.dedup));
    existing = new Set(
      (data ?? []).map((row) => row.dedup_key).filter((key): key is string => typeof key === "string"),
    );
  }

  const toInsert: Record<string, unknown>[] = [];
  const nowMs = Date.now();
  for (const candidate of candidates) {
    if (existing.has(candidate.dedup)) continue;
    const occurredAtMs = candidate.occurredAt ? Date.parse(candidate.occurredAt) : Number.NaN;
    const detectionLatencySec = Number.isFinite(occurredAtMs) ? Math.max(0, Math.round((nowMs - occurredAtMs) / 1000)) : null;
    const evidenceHash = await sha256Hex(`${candidate.title}|${candidate.link}|${candidate.occurredAt ?? "unknown-report-time"}`);
    toInsert.push({
      detection_latency_seconds: detectionLatencySec,
      last_pipeline_stage: "ingested",
      title: candidate.title.slice(0, 500),
      summary: candidate.title.slice(0, 2000),
      category: candidate.category,
      status: "new",
      confidence_score: 75,
      impact_score: 65,
      urgency_score: 70,
      source_count: 1,
      primary_source: "ReliefWeb",
      source_references: [{ url: candidate.link, name: "ReliefWeb (UN OCHA)", published: candidate.occurredAt }],
      first_detected_at: candidate.occurredAt,
      latest_update_at: new Date().toISOString(),
      occurred_at: candidate.occurredAt,
      affected_regions: [],
      affected_countries: candidate.iso3s,
      affected_sectors: ["humanitarian"],
      affected_stakeholders: ["humanitarian-agencies"],
      evidence_hash: evidenceHash,
      ingestion_source: "reliefweb_firehose",
      dedup_key: candidate.dedup,
      source_trust_tier: "tier_1",
      multi_source_confirmed: false,
      related_signal_ids: [],
      enrichment_status: "pending_enrichment",
      enrichment_attempts: 0,
      ingested_at: new Date().toISOString(),
      official_source: true,
      official_source_present: true,
      canonical_source_name: "ReliefWeb",
      source_rank_score: 90,
      merged_source_count: 1,
    });
  }

  let inserted = 0;
  let insertErr: string | null = null;
  if (toInsert.length > 0) {
    const { data, error } = await supabase.from("global_signals").insert(toInsert).select("id");
    if (error) {
      insertErr = error.message;
      console.error("reliefweb insert", error.message);
    } else inserted = data?.length ?? 0;
  }

  const { count: rowsAfter } = await supabase
    .from("global_signals").select("id", { count: "exact", head: true }).eq("ingestion_source", "reliefweb_firehose");

  const skipped = candidates.length - toInsert.length;
  const dur = Date.now() - start;
  let status: RunStatus;
  if (insertErr) status = "FAILED";
  else if (items.length === 0) status = api.error || fallback?.error ? "FAILED" : "WARNING_EMPTY_RESPONSE";
  else if (fallbackUsed) status = "SUCCESS_WITH_FALLBACK";
  else status = "SUCCESS";

  const telemetry = {
    status,
    api_endpoint: `https://api.reliefweb.int/v2/reports?appname=${APPNAME}`,
    api_http_status: api.httpStatus,
    api_latency_ms: api.latencyMs,
    api_error: api.error,
    fallback_used: fallbackUsed,
    fallback_http_status: fallback?.httpStatus ?? null,
    fallback_latency_ms: fallback?.latencyMs ?? null,
    fallback_error: fallback?.error ?? null,
    records_received: items.length,
    records_unique: candidates.length,
    records_inserted: inserted,
    records_updated: 0,
    records_skipped: skipped,
    rows_written: inserted,
    rows_before: rowsBefore ?? null,
    rows_after: rowsAfter ?? null,
    execution_ms: dur,
    error_message: insertErr ?? api.error ?? fallback?.error ?? null,
  };

  await finishProviderRun(supabase, run, {
    records_fetched: items.length,
    records_inserted: inserted,
    records_updated: 0,
    records_deduplicated: skipped,
    error_count: status === "FAILED" ? 1 : 0,
    error_summary: telemetry.error_message,
  });
  try {
    await supabase.from("provider_runs").update({ params: { ...telemetry, appname: APPNAME } }).eq("id", run.id);
  } catch { /* fail-soft */ }

  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: status === "SUCCESS" || status === "SUCCESS_WITH_FALLBACK" ? "success" : status === "FAILED" ? "error" : "warning",
    message: `${status} lane=${fallbackUsed ? "rss" : "api"} http=${api.httpStatus} latency=${api.latencyMs}ms received=${items.length} unique=${candidates.length} written=${inserted} skipped=${skipped} rows=${rowsBefore ?? "?"}→${rowsAfter ?? "?"} dur=${dur}ms${telemetry.error_message ? " err=" + telemetry.error_message : ""}`,
  });

  await recordFirehoseHealth(supabase, {
    name: FN,
    trustTier: "tier_1",
    success: status !== "FAILED",
    insertedCount: inserted,
    durationMs: dur,
    errorMessage: telemetry.error_message ?? undefined,
  });

  const warnings = await evaluateHealth(supabase, { rowsWritten: inserted, fallbackUsed, status });
  return new Response(JSON.stringify({ ok: status !== "FAILED", ...telemetry, warnings }), {
    status: status === "FAILED" ? 502 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
