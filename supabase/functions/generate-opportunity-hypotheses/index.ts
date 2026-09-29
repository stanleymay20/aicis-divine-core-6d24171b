import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  generateOpportunityHypotheses,
  OPPORTUNITY_HYPOTHESIS_VERSION,
} from "../_shared/opportunity-hypothesis-v1.mjs";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type JsonRecord = Record<string, unknown>;

type RelevanceRow = {
  signal_id: string;
  relevance_score: number;
  relevance_tier: string;
  relevance_reason: unknown;
  computed_at: string;
};

type OpportunitySignal = JsonRecord & {
  id?: string;
  title?: string;
  canonical_event_id?: string | null;
  dedup_key?: string | null;
};

function normalizedTitle(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 220);
}

function deduplicateSignals(signals: OpportunitySignal[]) {
  const seen = new Set<string>();
  const unique: OpportunitySignal[] = [];

  for (const signal of signals) {
    const key = String(signal.canonical_event_id || "").trim()
      || String(signal.dedup_key || "").trim()
      || normalizedTitle(signal.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(signal);
  }

  return unique;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const requestedLimit = Number.isFinite(Number(body.limit))
      ? Math.max(Math.floor(Number(body.limit)), 1)
      : 100;

    const { data: prefs } = await sb
      .from("aicis_relevance_preferences")
      .select("alert_preferences")
      .eq("user_id", user.id)
      .maybeSingle();

    const alertPreferences = asRecord(prefs?.alert_preferences);
    const opportunityProfile = asRecord(alertPreferences.opportunity_profile);
    const minRelevance = Number.isFinite(Number(body.min_relevance_score))
      ? Number(body.min_relevance_score)
      : Number.isFinite(Number(opportunityProfile.min_relevance_score))
        ? Number(opportunityProfile.min_relevance_score)
        : 45;

    const scanScope = String(body.scope || "personalized").trim().toLowerCase() === "global"
      ? "global"
      : "personalized";
    const limit = scanScope === "global"
      ? Math.min(requestedLimit, 500)
      : Math.min(requestedLimit, 300);
    const windowDays = Number.isFinite(Number(body.window_days))
      ? Math.min(Math.max(Math.floor(Number(body.window_days)), 1), 30)
      : 7;

    const relevanceBySignal: Record<string, RelevanceRow> = {};
    let signals: OpportunitySignal[] = [];
    let rawSignalsScanned = 0;

    if (scanScope === "global") {
      const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
      // Two-step fetch: a narrow indexed id lookup, then wide rows in parallel
      // id chunks. One wide ordered query over the window exceeded 150s under load.
      const { data: idRows, error: idError } = await sb
        .from("global_signals")
        .select("id")
        .gte("first_detected_at", since)
        .order("first_detected_at", { ascending: false })
        .limit(limit);
      if (idError) throw idError;
      const signalIds = (idRows ?? []).map((row: { id: string }) => row.id);
      const idChunks = Array.from({ length: Math.ceil(signalIds.length / 100) }, (_, i) => signalIds.slice(i * 100, i * 100 + 100));
      const wideResults = await Promise.all(idChunks.map((chunk) => sb
        .from("global_signals")
        .select("id,title,summary,category,subcategory,affected_countries,affected_regions,affected_sectors,affected_stakeholders,source_references,evidence_hash,source_identifier_count:source_count,first_detected_at,ingested_at,occurred_at,canonical_event_id,dedup_key")
        .in("id", chunk)));
      const globalSignals: OpportunitySignal[] = [];
      for (const { data, error } of wideResults) {
        if (error) throw error;
        globalSignals.push(...((data ?? []) as OpportunitySignal[]));
      }
      globalSignals.sort((a, b) => String((b as { first_detected_at?: string }).first_detected_at ?? "").localeCompare(String((a as { first_detected_at?: string }).first_detected_at ?? "")));

      rawSignalsScanned = globalSignals.length;
      signals = deduplicateSignals((globalSignals ?? []) as OpportunitySignal[]);

      // No scores for this user means there is nothing to annotate. This probe prevents
      // eleven expensive, empty ID lookups on installations with no personalized scores.
      const { data: scoreProbe, error: scoreProbeError } = signals.length
        ? await sb.from("signal_relevance_scores").select("signal_id").eq("user_id", user.id).limit(1)
        : { data: [], error: null };
      if (scoreProbeError) throw scoreProbeError;
      if (signals.length && scoreProbe?.length) {
        const ids = signals.map((signal) => signal.id).filter((id): id is string => Boolean(id));
        // Bound concurrency: serial lookups multiplied database latency by every 80-signal chunk.
        // These rows are optional user-specific annotations; a failed lookup must not invent a score.
        for (let index = 0; index < ids.length; index += 320) {
          const batch = ids.slice(index, index + 320);
          const chunks = Array.from({ length: Math.ceil(batch.length / 80) }, (_, i) => batch.slice(i * 80, i * 80 + 80));
          const results = await Promise.all(chunks.map((chunk) => sb
            .from("signal_relevance_scores")
            .select("signal_id,relevance_score,relevance_tier,relevance_reason,computed_at")
            .eq("user_id", user.id)
            .in("signal_id", chunk)));
          for (const { data: relevanceRows, error: relevanceError } of results) {
            if (relevanceError) throw relevanceError;
            for (const row of (relevanceRows ?? []) as RelevanceRow[]) {
              relevanceBySignal[row.signal_id] = row;
            }
          }
        }
      }
    } else {
      const { data: relevanceRows, error: relevanceError } = await sb
        .from("signal_relevance_scores")
        .select("signal_id,relevance_score,relevance_tier,relevance_reason,computed_at")
        .eq("user_id", user.id)
        .gte("relevance_score", minRelevance)
        .order("relevance_score", { ascending: false })
        .limit(limit);
      if (relevanceError) throw relevanceError;

      const typedRelevanceRows = (relevanceRows ?? []) as RelevanceRow[];
      const ids = typedRelevanceRows.map((row) => row.signal_id).filter(Boolean);
      if (ids.length === 0) {
        return json({
          ok: true,
          hypothesis_version: OPPORTUNITY_HYPOTHESIS_VERSION,
          scan_scope: scanScope,
          min_relevance_score: minRelevance,
          raw_signals_scanned: 0,
          signals_scanned: 0,
          deduplicated_count: 0,
          hypotheses: [],
          scope_notice: "Personalized opportunity discovery is limited to signals scored for this user.",
        });
      }

      const { data: personalizedSignals, error: signalError } = await sb
        .from("global_signals")
        .select("id,title,summary,category,subcategory,affected_countries,affected_regions,affected_sectors,affected_stakeholders,source_references,evidence_hash,source_identifier_count:source_count,canonical_event_id,dedup_key")
        .in("id", ids);
      if (signalError) throw signalError;

      rawSignalsScanned = personalizedSignals?.length ?? 0;
      signals = deduplicateSignals((personalizedSignals ?? []) as OpportunitySignal[]);
      for (const row of typedRelevanceRows) {
        relevanceBySignal[row.signal_id] = row;
      }
    }

    const hypotheses = generateOpportunityHypotheses(signals, relevanceBySignal);

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "generate_opportunity_hypotheses",
      result: hypotheses.length ? "hypotheses_generated" : "no_supported_product_hypotheses",
      log_level: "info",
      metadata: {
        hypothesis_version: OPPORTUNITY_HYPOTHESIS_VERSION,
        scan_scope: scanScope,
        min_relevance_score: minRelevance,
        window_days: scanScope === "global" ? windowDays : null,
        raw_signals_scanned: rawSignalsScanned,
        signals_scanned: signals.length,
        deduplicated_count: Math.max(0, rawSignalsScanned - signals.length),
        hypotheses_generated: hypotheses.length,
        transaction_eligible: 0,
      },
    });

    return json({
      ok: true,
      hypothesis_version: OPPORTUNITY_HYPOTHESIS_VERSION,
      scan_scope: scanScope,
      min_relevance_score: minRelevance,
      window_days: scanScope === "global" ? windowDays : null,
      raw_signals_scanned: rawSignalsScanned,
      signals_scanned: signals.length,
      deduplicated_count: Math.max(0, rawSignalsScanned - signals.length),
      hypotheses,
      guardrail: "Hypotheses are research prompts only. They contain no verified transaction economics and are not execution recommendations.",
      scope_notice: scanScope === "global"
        ? "Global scan means the recent signals currently available in the AICIS evidence corpus. It is not a claim of exhaustive coverage of every market, village, company or transaction worldwide."
        : "Personalized discovery is limited to signals scored for this user.",
    });
  } catch (error) {
    console.error("generate-opportunity-hypotheses failed", error);
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
    const message = error instanceof Error ? error.message :
      typeof error === "object" && error !== null && "message" in error ? String(error.message) : "Opportunity hypothesis generation failed";
    return json({
      ok: false,
      error: code === "57014" ? "The signal search took too long. Please try again shortly." : message,
      ...(code ? { code } : {}),
    }, code === "57014" ? 503 : 500);
  }
});
