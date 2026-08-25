// Phase 1 — Adaptive Relevance Learning
// Learns lightweight user relevance weight adjustments from user_signal_feedback.
// Deterministic, bounded, and safe: never lets one feedback event radically change a profile.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const DEFAULT_WEIGHTS: Record<string, number> = {
  domain_match: 0.20,
  geo_match: 0.20,
  sector_match: 0.15,
  entity_match: 0.15,
  impact: 0.10,
  urgency: 0.10,
  confidence: 0.05,
  novelty_anomaly: 0.05,
};

const MIN_WEIGHT = 0.03;
const MAX_WEIGHT = 0.35;
const STEP = 0.015;

type Profile = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  watched_countries: string[] | null;
  watched_sectors: string[] | null;
  watched_topics: string[] | null;
  watched_entities: string[] | null;
  excluded_topics: string[] | null;
  weights: Record<string, number> | null;
};

type SignalSummary = {
  title: string;
  summary: string | null;
  category: string | null;
  affected_countries: string[] | null;
  affected_sectors: string[] | null;
  affected_stakeholders: string[] | null;
  impact_score: number | null;
  urgency_score: number | null;
  confidence_score: number | null;
  novelty_score: number | null;
};

type FeedbackRow = {
  id: string;
  user_id: string;
  signal_id: string;
  feedback_type: "important" | "not_relevant" | "save" | "dismiss" | "escalate";
  feedback_context: Record<string, unknown> | null;
  created_at: string;
  signal?: SignalSummary | null;
};

type LearningSummary = {
  user_id: string;
  feedback_rows: number;
  weights: Record<string, number>;
};

function clamp(n: number, lo = MIN_WEIGHT, hi = MAX_WEIGHT) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeWeights(weights: Record<string, number>) {
  const next: Record<string, number> = {};
  let sum = 0;
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const value = clamp(Number(weights[key] ?? DEFAULT_WEIGHTS[key]));
    next[key] = value;
    sum += value;
  }
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(next)) next[key] = Number((next[key] / sum).toFixed(4));
  return next;
}

function textTerms(text: string) {
  return Array.from(new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4)
      .slice(0, 50),
  ));
}

function hasOverlap(a?: string[] | null, b?: string[] | null) {
  const values = new Set((a ?? []).map((item) => String(item).toLowerCase()));
  return (b ?? []).some((item) => values.has(String(item).toLowerCase()));
}

function nudgeWeights(profile: Profile, rows: FeedbackRow[]) {
  const weights = normalizeWeights({ ...DEFAULT_WEIGHTS, ...(profile.weights ?? {}) });
  const addTopics = new Set<string>();
  const addCountries = new Set<string>();
  const addSectors = new Set<string>();
  const excludeTopics = new Set<string>();

  for (const row of rows) {
    const signal = row.signal;
    if (!signal) continue;
    const positive = row.feedback_type === "important" || row.feedback_type === "save" || row.feedback_type === "escalate";
    const negative = row.feedback_type === "not_relevant" || row.feedback_type === "dismiss";
    const multiplier = row.feedback_type === "escalate" ? 2 : 1;
    const delta = STEP * multiplier;

    const titleSummary = `${signal.title || ""} ${signal.summary || ""} ${signal.category || ""}`;
    const topicCandidates = [signal.category, ...textTerms(titleSummary).slice(0, 8)]
      .filter((item): item is string => Boolean(item));
    const signalCountries = signal.affected_countries ?? [];
    const signalSectors = signal.affected_sectors ?? [];
    const entityCandidates = signal.affected_stakeholders ?? [];

    if (positive) {
      if (signalCountries.length > 0) weights.geo_match = clamp(weights.geo_match + delta);
      if (signalSectors.length > 0) weights.sector_match = clamp(weights.sector_match + delta);
      if (topicCandidates.length > 0) weights.domain_match = clamp(weights.domain_match + delta);
      if (entityCandidates.length > 0) weights.entity_match = clamp(weights.entity_match + delta);
      if ((signal.impact_score ?? 0) >= 65) weights.impact = clamp(weights.impact + delta);
      if ((signal.urgency_score ?? 0) >= 65 || row.feedback_type === "escalate") weights.urgency = clamp(weights.urgency + delta);
      if ((signal.novelty_score ?? 0) >= 70) weights.novelty_anomaly = clamp(weights.novelty_anomaly + delta);
      for (const country of signalCountries.slice(0, 5)) addCountries.add(country);
      for (const sector of signalSectors.slice(0, 5)) addSectors.add(sector);
      for (const topic of topicCandidates.slice(0, 5)) addTopics.add(topic);
    }

    if (negative) {
      if (hasOverlap(profile.watched_countries, signalCountries)) weights.geo_match = clamp(weights.geo_match - delta);
      if (hasOverlap(profile.watched_sectors, signalSectors)) weights.sector_match = clamp(weights.sector_match - delta);
      weights.domain_match = clamp(weights.domain_match - delta / 2);
      if ((signal.confidence_score ?? 0) < 50) weights.confidence = clamp(weights.confidence + delta / 2);
      for (const topic of topicCandidates.slice(0, 3)) excludeTopics.add(topic);
    }
  }

  return {
    weights: normalizeWeights(weights),
    addTopics: Array.from(addTopics),
    addCountries: Array.from(addCountries),
    addSectors: Array.from(addSectors),
    excludeTopics: Array.from(excludeTopics),
  };
}

function mergeLimited(existing: string[] | null, additions: string[], limit = 80) {
  const out = new Set((existing ?? []).map((item) => String(item).toLowerCase()));
  for (const item of additions) {
    if (!item) continue;
    out.add(String(item).toLowerCase());
    if (out.size >= limit) break;
  }
  return Array.from(out).slice(0, limit);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const started = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const rawBody: unknown = await req.json().catch(() => ({}));
    const body = isRecord(rawBody) ? rawBody : {};
    const userId = typeof body.user_id === "string" && body.user_id.trim() ? body.user_id.trim() : null;
    const requestedLookback = Number(body.lookback_hours ?? 168);
    const lookbackHours = Math.min(Math.max(Number.isFinite(requestedLookback) ? requestedLookback : 168, 1), 720);
    const since = new Date(Date.now() - lookbackHours * 3_600_000).toISOString();

    let profileQuery = supabase
      .from("user_relevance_profiles")
      .select("id,user_id,workspace_id,watched_countries,watched_sectors,watched_topics,watched_entities,excluded_topics,weights")
      .limit(200);
    if (userId) profileQuery = profileQuery.eq("user_id", userId);
    const { data: profilesData, error: profileError } = await profileQuery;
    if (profileError) throw profileError;

    const profiles = (profilesData ?? []) as Profile[];
    let updated = 0;
    const summaries: LearningSummary[] = [];

    for (const profile of profiles) {
      const { data: feedbackData, error: feedbackError } = await supabase
        .from("user_signal_feedback")
        .select(`
          id,user_id,signal_id,feedback_type,feedback_context,created_at,
          signal:global_signals(title,summary,category,affected_countries,affected_sectors,affected_stakeholders,impact_score,urgency_score,confidence_score,novelty_score)
        `)
        .eq("user_id", profile.user_id)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);
      if (feedbackError) throw feedbackError;

      const rows = (feedbackData ?? []) as FeedbackRow[];
      if (rows.length === 0) continue;

      const learned = nudgeWeights(profile, rows);
      const patch = {
        weights: learned.weights,
        watched_topics: mergeLimited(profile.watched_topics, learned.addTopics),
        watched_countries: mergeLimited(profile.watched_countries, learned.addCountries),
        watched_sectors: mergeLimited(profile.watched_sectors, learned.addSectors),
        excluded_topics: mergeLimited(profile.excluded_topics, learned.excludeTopics, 120),
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from("user_relevance_profiles")
        .update(patch)
        .eq("id", profile.id);
      if (updateError) throw updateError;

      updated += 1;
      summaries.push({ user_id: profile.user_id, feedback_rows: rows.length, weights: learned.weights });
    }

    await supabase.from("automation_logs").insert({
      job_name: "learn-relevance-profile",
      status: "success",
      message: `updated=${updated} lookback_hours=${lookbackHours} in ${Date.now() - started}ms`,
    });

    return json({ ok: true, updated, summaries, elapsed_ms: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("automation_logs").insert({
      job_name: "learn-relevance-profile",
      status: "error",
      message: message.slice(0, 500),
    });
    return json({ ok: false, error: message }, 500);
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
