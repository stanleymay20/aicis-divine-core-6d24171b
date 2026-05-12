// Phase 1 — Adaptive Relevance Learning
// Learns lightweight user relevance weight adjustments from user_signal_feedback.
// Deterministic, bounded, and safe: never lets one feedback event radically change a profile.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

type FeedbackRow = {
  id: string;
  user_id: string;
  signal_id: string;
  feedback_type: "important" | "not_relevant" | "save" | "dismiss" | "escalate";
  feedback_context: any;
  created_at: string;
  signal?: {
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
};

function clamp(n: number, lo = MIN_WEIGHT, hi = MAX_WEIGHT) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeWeights(weights: Record<string, number>) {
  const next: Record<string, number> = {};
  let sum = 0;
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const v = clamp(Number(weights[key] ?? DEFAULT_WEIGHTS[key]));
    next[key] = v;
    sum += v;
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
      .filter((w) => w.length >= 4)
      .slice(0, 50),
  ));
}

function hasOverlap(a?: string[] | null, b?: string[] | null) {
  const A = new Set((a ?? []).map((x) => String(x).toLowerCase()));
  return (b ?? []).some((x) => A.has(String(x).toLowerCase()));
}

function nudgeWeights(profile: Profile, rows: FeedbackRow[]) {
  let weights = normalizeWeights({ ...DEFAULT_WEIGHTS, ...(profile.weights ?? {}) });
  const addTopics = new Set<string>();
  const addCountries = new Set<string>();
  const addSectors = new Set<string>();
  const excludeTopics = new Set<string>();

  for (const row of rows) {
    const sig = row.signal;
    if (!sig) continue;
    const positive = row.feedback_type === "important" || row.feedback_type === "save" || row.feedback_type === "escalate";
    const negative = row.feedback_type === "not_relevant" || row.feedback_type === "dismiss";
    const multiplier = row.feedback_type === "escalate" ? 2 : 1;
    const delta = STEP * multiplier;

    const titleSummary = `${sig.title || ""} ${sig.summary || ""} ${sig.category || ""}`;
    const topicCandidates = [sig.category, ...textTerms(titleSummary).slice(0, 8)].filter(Boolean) as string[];
    const signalCountries = sig.affected_countries ?? [];
    const signalSectors = sig.affected_sectors ?? [];
    const entityCandidates = sig.affected_stakeholders ?? [];

    if (positive) {
      if (signalCountries.length > 0) weights.geo_match = clamp(weights.geo_match + delta);
      if (signalSectors.length > 0) weights.sector_match = clamp(weights.sector_match + delta);
      if (topicCandidates.length > 0) weights.domain_match = clamp(weights.domain_match + delta);
      if (entityCandidates.length > 0) weights.entity_match = clamp(weights.entity_match + delta);
      if ((sig.impact_score ?? 0) >= 65) weights.impact = clamp(weights.impact + delta);
      if ((sig.urgency_score ?? 0) >= 65 || row.feedback_type === "escalate") weights.urgency = clamp(weights.urgency + delta);
      if ((sig.novelty_score ?? 0) >= 70) weights.novelty_anomaly = clamp(weights.novelty_anomaly + delta);
      for (const c of signalCountries.slice(0, 5)) addCountries.add(c);
      for (const s of signalSectors.slice(0, 5)) addSectors.add(s);
      for (const t of topicCandidates.slice(0, 5)) addTopics.add(t);
    }

    if (negative) {
      if (hasOverlap(profile.watched_countries, signalCountries)) weights.geo_match = clamp(weights.geo_match - delta);
      if (hasOverlap(profile.watched_sectors, signalSectors)) weights.sector_match = clamp(weights.sector_match - delta);
      weights.domain_match = clamp(weights.domain_match - delta / 2);
      if ((sig.confidence_score ?? 0) < 50) weights.confidence = clamp(weights.confidence + delta / 2);
      for (const t of topicCandidates.slice(0, 3)) excludeTopics.add(t);
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
  const out = new Set((existing ?? []).map((x) => String(x).toLowerCase()));
  for (const item of additions) {
    if (!item) continue;
    out.add(String(item).toLowerCase());
    if (out.size >= limit) break;
  }
  return Array.from(out).slice(0, limit);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const userId = body.user_id ? String(body.user_id) : null;
    const lookbackHours = Math.min(Number(body.lookback_hours ?? 168), 720);
    const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString();

    let profileQuery = sb
      .from("user_relevance_profiles")
      .select("id,user_id,workspace_id,watched_countries,watched_sectors,watched_topics,watched_entities,excluded_topics,weights")
      .limit(200);
    if (userId) profileQuery = profileQuery.eq("user_id", userId);
    const { data: profiles, error: pErr } = await profileQuery;
    if (pErr) throw pErr;

    let updated = 0;
    const summaries: any[] = [];

    for (const profile of (profiles ?? []) as Profile[]) {
      const { data: feedback, error: fErr } = await sb
        .from("user_signal_feedback")
        .select(`
          id,user_id,signal_id,feedback_type,feedback_context,created_at,
          signal:global_signals(title,summary,category,affected_countries,affected_sectors,affected_stakeholders,impact_score,urgency_score,confidence_score,novelty_score)
        `)
        .eq("user_id", profile.user_id)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);
      if (fErr) throw fErr;

      const rows = (feedback ?? []) as FeedbackRow[];
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

      const { error: uErr } = await sb
        .from("user_relevance_profiles")
        .update(patch)
        .eq("id", profile.id);
      if (uErr) throw uErr;

      updated++;
      summaries.push({ user_id: profile.user_id, feedback_rows: rows.length, weights: learned.weights });
    }

    await sb.from("automation_logs").insert({
      job_name: "learn-relevance-profile",
      status: "success",
      message: `updated=${updated} lookback_hours=${lookbackHours} in ${Date.now() - started}ms`,
    });

    return new Response(JSON.stringify({ ok: true, updated, summaries, elapsed_ms: Date.now() - started }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    await sb.from("automation_logs").insert({
      job_name: "learn-relevance-profile",
      status: "error",
      message: msg.slice(0, 500),
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
