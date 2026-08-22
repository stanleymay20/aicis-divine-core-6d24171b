// Phase 1 — Relevance Intelligence Layer
// Scores canonical global_signals against user_relevance_profiles.
// Deterministic scoring: no AI call and safe for frequent authenticated/cron use.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdminOrCron, requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH = 500;

type Profile = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  watched_countries: string[] | null;
  watched_regions: string[] | null;
  watched_sectors: string[] | null;
  watched_topics: string[] | null;
  watched_entities: string[] | null;
  excluded_topics: string[] | null;
  alert_threshold: number;
  discovery_threshold: number;
  weights: Record<string, number> | null;
};

type Signal = {
  id: string;
  title: string;
  summary: string | null;
  category: string | null;
  subcategory: string | null;
  affected_countries: string[] | null;
  affected_regions: string[] | null;
  affected_sectors: string[] | null;
  affected_stakeholders: string[] | null;
  confidence_score: number | null;
  urgency_score: number | null;
  impact_score: number | null;
  source_trust_tier: string | null;
  novelty_score: number | null;
  corroboration_count: number | null;
  merged_source_count: number | null;
  first_detected_at: string;
  latest_update_at: string | null;
};

const DEFAULT_WEIGHTS = {
  domain_match: 0.20,
  geo_match: 0.20,
  sector_match: 0.15,
  entity_match: 0.15,
  impact: 0.10,
  urgency: 0.10,
  confidence: 0.05,
  novelty_anomaly: 0.05,
};

const DEFAULT_TOPICS = [
  "geopolitical",
  "defense",
  "conflict",
  "supply chain",
  "energy",
  "cybersecurity",
  "public health",
  "climate",
  "food",
  "finance",
  "infrastructure",
  "migration",
];

const DEFAULT_SECTORS = [
  "energy",
  "finance",
  "health",
  "food",
  "security",
  "logistics",
  "technology",
  "infrastructure",
  "humanitarian",
];

function arr(value: string[] | null | undefined): string[] {
  return Array.isArray(value)
    ? value.filter(Boolean).map((item) => String(item).toLowerCase())
    : [];
}

function overlap(
  a: string[] | null | undefined,
  b: string[] | null | undefined,
): { hit: boolean; matches: string[] } {
  const A = new Set(arr(a));
  const B = arr(b);
  const matches = B.filter((item) => A.has(item));
  return { hit: matches.length > 0, matches };
}

function textIncludes(
  text: string,
  terms: string[] | null | undefined,
): { hit: boolean; matches: string[] } {
  const lower = text.toLowerCase();
  const matches = arr(terms).filter((term) => term.length >= 2 && lower.includes(term));
  return { hit: matches.length > 0, matches };
}

function clamp(number: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, number));
}

function normScore(number: number | null | undefined) {
  if (typeof number !== "number" || Number.isNaN(number)) return 0;
  return clamp(number);
}

function trustScore(tier: string | null): number {
  if (tier === "tier_1") return 100;
  if (tier === "tier_2") return 78;
  if (tier === "tier_3") return 55;
  return 35;
}

function tierOf(score: number): "critical" | "important" | "monitor" | "discovery" | "hidden" {
  if (score >= 85) return "critical";
  if (score >= 70) return "important";
  if (score >= 55) return "monitor";
  if (score >= 40) return "discovery";
  return "hidden";
}

function relevance(signal: Signal, profile: Profile) {
  const weights = { ...DEFAULT_WEIGHTS, ...(profile.weights ?? {}) };
  const haystack = [
    signal.title,
    signal.summary,
    signal.category,
    signal.subcategory,
    ...(signal.affected_stakeholders ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  const country = overlap(profile.watched_countries, signal.affected_countries);
  const region = overlap(profile.watched_regions, signal.affected_regions);
  const sector = overlap(profile.watched_sectors, signal.affected_sectors);
  const topics = textIncludes(haystack, profile.watched_topics);
  const entities = textIncludes(haystack, profile.watched_entities);
  const excluded = textIncludes(haystack, profile.excluded_topics);

  const domainMatch = topics.hit || (profile.watched_topics?.length ?? 0) === 0
    ? topics.hit ? 100 : 45
    : 0;
  const geoMatch = country.hit
    ? 100
    : region.hit
      ? 70
      : (profile.watched_countries?.length ?? 0) === 0
        ? 45
        : 0;
  const sectorMatch = sector.hit
    ? 100
    : (profile.watched_sectors?.length ?? 0) === 0
      ? 45
      : 0;
  const entityMatch = entities.hit
    ? 100
    : (profile.watched_entities?.length ?? 0) === 0
      ? 35
      : 0;

  const impact = normScore(signal.impact_score);
  const urgency = normScore(signal.urgency_score);
  const confidence = normScore(signal.confidence_score);
  const novelty = normScore(signal.novelty_score ?? 50);
  const corroboration = Math.min(
    100,
    Math.max(0, ((signal.corroboration_count ?? signal.merged_source_count ?? 1) - 1) * 18),
  );
  const anomalyWeakSignalBoost = Math.max(
    novelty,
    corroboration,
    urgency >= 70 && confidence < 55 ? 75 : 0,
  );

  let score =
    domainMatch * weights.domain_match +
    geoMatch * weights.geo_match +
    sectorMatch * weights.sector_match +
    entityMatch * weights.entity_match +
    impact * weights.impact +
    urgency * weights.urgency +
    confidence * weights.confidence +
    anomalyWeakSignalBoost * weights.novelty_anomaly;

  const sourceTrust = trustScore(signal.source_trust_tier);
  if (sourceTrust < 45 && score >= 70) score -= 8;
  if (excluded.hit) score -= 35;

  const weakSignalProtected =
    novelty >= 85 || corroboration >= 45 || (urgency >= 75 && impact >= 60);
  if (weakSignalProtected) {
    score = Math.max(score, profile.discovery_threshold ?? 40);
  }

  score = clamp(Math.round(score));

  return {
    relevance_score: score,
    relevance_tier: tierOf(score),
    relevance_reason: {
      formula_version: "phase_1_v1",
      components: {
        domain_match: domainMatch,
        geo_match: geoMatch,
        sector_match: sectorMatch,
        entity_match: entityMatch,
        impact,
        urgency,
        confidence,
        novelty_anomaly: anomalyWeakSignalBoost,
        source_trust: sourceTrust,
      },
      matches: {
        countries: country.matches,
        regions: region.matches,
        sectors: sector.matches,
        topics: topics.matches,
        entities: entities.matches,
        excluded_topics: excluded.matches,
      },
      weak_signal_protected: weakSignalProtected,
      explanation: explain(score, {
        country,
        region,
        sector,
        topics,
        entities,
        weakSignalProtected,
        excluded,
      }),
    },
  };
}

function explain(score: number, ctx: any): string {
  if (ctx.excluded.hit) return "Lowered because it matched an excluded topic.";
  if (score >= 85) return "Critical because it strongly matches watched context and has high urgency or impact.";
  if (score >= 70) return "Important because it overlaps with watched geography, sector, topic, or entity.";
  if (score >= 55) return "Monitor because it has partial relevance or meaningful operational severity.";
  if (ctx.weakSignalProtected) return "Discovery because it is an unusual or emerging weak signal worth preserving.";
  return "Hidden from default alerts because it has low user-context relevance.";
}

async function ensureProfile(sb: any, userId: string): Promise<Profile> {
  const { data: existing, error: readError } = await sb
    .from("user_relevance_profiles")
    .select("id,user_id,workspace_id,watched_countries,watched_regions,watched_sectors,watched_topics,watched_entities,excluded_topics,alert_threshold,discovery_threshold,weights")
    .eq("user_id", userId)
    .is("workspace_id", null)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return existing as Profile;

  const { data: created, error: insertError } = await sb
    .from("user_relevance_profiles")
    .insert({
      user_id: userId,
      workspace_id: null,
      watched_topics: DEFAULT_TOPICS,
      watched_sectors: DEFAULT_SECTORS,
      watched_countries: [],
      watched_regions: [],
      watched_entities: [],
      excluded_topics: ["sports", "celebrity", "game review", "shopping deal"],
      alert_threshold: 70,
      discovery_threshold: 40,
      weights: DEFAULT_WEIGHTS,
    })
    .select("id,user_id,workspace_id,watched_countries,watched_regions,watched_sectors,watched_topics,watched_entities,excluded_topics,alert_threshold,discovery_threshold,weights")
    .single();
  if (insertError) throw insertError;
  return created as Profile;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const privileged = await requireAdminOrCron(req, corsHeaders);
  let privilegedMode = privileged.response === null;
  let actorUserId: string | null = privileged.user?.id ?? null;

  if (!privilegedMode) {
    const { ctx, response } = await requireUser(req, corsHeaders);
    if (response || !ctx) return response!;
    actorUserId = ctx.user.id;
  }

  const started = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const requestedLimit = Number(body.limit ?? BATCH);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 2000)
      : BATCH;
    const requestedUserId = body.user_id ? String(body.user_id) : null;
    const bootstrap = body.bootstrap !== false;

    if (!privilegedMode && requestedUserId && requestedUserId !== actorUserId) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden", reason: "cross_user_scope" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cron/admin may score one requested user or all profiles. Ordinary users
    // are always scoped to their authenticated user id regardless of body data.
    const userId = privilegedMode ? requestedUserId : actorUserId;

    let profiles: Profile[] = [];
    if (userId && bootstrap) {
      profiles = [await ensureProfile(sb, userId)];
    } else {
      let profileQuery = sb
        .from("user_relevance_profiles")
        .select("id,user_id,workspace_id,watched_countries,watched_regions,watched_sectors,watched_topics,watched_entities,excluded_topics,alert_threshold,discovery_threshold,weights")
        .limit(privilegedMode ? 200 : 1);

      if (userId) {
        profileQuery = profileQuery.eq("user_id", userId);
      } else if (!privilegedMode) {
        throw new Error("Authenticated relevance scoring requires a user scope");
      }

      const { data, error: profileError } = await profileQuery;
      if (profileError) throw profileError;
      profiles = (data ?? []) as Profile[];
    }

    if (profiles.length === 0) {
      await sb.from("automation_logs").insert({
        job_name: "score-signal-relevance",
        status: "success",
        message: "No relevance profiles found; nothing scored.",
      });
      return new Response(JSON.stringify({ ok: true, profiles: 0, scored: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: signals, error: signalError } = await sb
      .from("global_signals")
      .select("id,title,summary,category,subcategory,affected_countries,affected_regions,affected_sectors,affected_stakeholders,confidence_score,urgency_score,impact_score,source_trust_tier,novelty_score,corroboration_count,merged_source_count,first_detected_at,latest_update_at")
      .eq("canonical_event_status", "canonical")
      .order("latest_update_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (signalError) throw signalError;

    const rows: any[] = [];
    for (const profile of profiles) {
      for (const signal of (signals ?? []) as Signal[]) {
        const result = relevance(signal, profile);
        rows.push({
          signal_id: signal.id,
          user_id: profile.user_id,
          workspace_id: profile.workspace_id,
          relevance_score: result.relevance_score,
          relevance_tier: result.relevance_tier,
          relevance_reason: result.relevance_reason,
          computed_at: new Date().toISOString(),
        });
      }
    }

    let written = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await sb
        .from("signal_relevance_scores")
        .upsert(chunk, { onConflict: "signal_id,user_id,workspace_id" });
      if (error) throw error;
      written += chunk.length;
    }

    const counts = rows.reduce((acc: Record<string, number>, row) => {
      acc[row.relevance_tier] = (acc[row.relevance_tier] ?? 0) + 1;
      return acc;
    }, {});

    await sb.from("automation_logs").insert({
      job_name: "score-signal-relevance",
      status: "success",
      message: `profiles=${profiles.length} signals=${signals?.length ?? 0} scored=${written} counts=${JSON.stringify(counts)} in ${Date.now() - started}ms`,
    });

    return new Response(JSON.stringify({
      ok: true,
      scope: privilegedMode ? (userId ? "privileged_user" : "privileged_all") : "self",
      profiles: profiles.length,
      signals: signals?.length ?? 0,
      scored: written,
      counts,
      elapsed_ms: Date.now() - started,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sb.from("automation_logs").insert({
      job_name: "score-signal-relevance",
      status: "error",
      message: message.slice(0, 500),
    });
    console.error(JSON.stringify({
      level: "error",
      function: "score-signal-relevance",
      message,
      actor_user_id: actorUserId,
      privileged: privilegedMode,
      timestamp: new Date().toISOString(),
    }));
    return new Response(JSON.stringify({ ok: false, error: "Relevance scoring failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
