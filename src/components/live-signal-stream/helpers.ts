import { type RelevanceScore, type RelevanceTier, type Signal, WINDOW_MS } from "./types";

export function tierColor(tier: string | null) {
  switch (tier) {
    case "tier_1": return "bg-emerald-500/15 text-emerald-300 border-emerald-700/50";
    case "tier_2": return "bg-sky-500/15 text-sky-300 border-sky-700/50";
    default:       return "bg-zinc-500/15 text-zinc-300 border-zinc-700/50";
  }
}

export function relevanceBadgeColor(tier: RelevanceTier | null | undefined) {
  switch (tier) {
    case "critical": return "bg-red-500/15 text-red-300 border-red-700/50";
    case "important": return "bg-orange-500/15 text-orange-300 border-orange-700/50";
    case "monitor": return "bg-sky-500/15 text-sky-300 border-sky-700/50";
    case "discovery": return "bg-violet-500/15 text-violet-300 border-violet-700/50";
    case "hidden": return "bg-zinc-500/15 text-zinc-300 border-zinc-700/50";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export function sourceBadge(s: Signal) {
  if (s.ingestion_source === "detection_audit_recovery") {
    return { label: "RECOVERED", className: "bg-amber-500/20 text-amber-200 border-amber-600/60" };
  }
  if (s.ingestion_source === "firecrawl_search") {
    return { label: "WEB SWEEP", className: "bg-violet-500/15 text-violet-200 border-violet-700/50" };
  }
  return { label: (s.ingestion_source || "wire").slice(0, 18), className: "bg-zinc-500/15 text-zinc-300 border-zinc-700/50" };
}

export function tierFromScore(score: number): RelevanceTier {
  if (score >= 85) return "critical";
  if (score >= 70) return "important";
  if (score >= 55) return "monitor";
  if (score >= 40) return "discovery";
  return "hidden";
}

export function fallbackRelevance(s: Signal): Pick<Signal, "relevance_score" | "relevance_tier" | "relevance_reason" | "relevance_is_fallback"> {
  const urgency = s.urgency_score ?? 0;
  const impact = s.impact_score ?? 0;
  const confidence = s.confidence_score ?? 0;
  const novelty = s.novelty_score ?? 50;
  const corrob = Math.min(100, Math.max(0, ((s.corroboration_count ?? 1) - 1) * 18));
  const sourceBoost = s.source_trust_tier === "tier_1" ? 8 : s.source_trust_tier === "tier_2" ? 4 : 0;
  const score = Math.max(
    0,
    Math.min(100, Math.round(impact * 0.28 + urgency * 0.28 + confidence * 0.18 + novelty * 0.12 + corrob * 0.08 + sourceBoost)),
  );
  const weakSignalProtected = novelty >= 85 || corrob >= 45 || (urgency >= 75 && impact >= 60);
  const finalScore = weakSignalProtected ? Math.max(score, 40) : score;
  return {
    relevance_score: finalScore,
    relevance_tier: tierFromScore(finalScore),
    relevance_is_fallback: true,
    relevance_reason: {
      formula_version: "ui_fallback_v1",
      explanation: weakSignalProtected
        ? "Discovery preserved because this is unusual, corroborated, or urgent even before user-specific scoring completes."
        : "Temporary operational relevance estimate until personalized scoring completes.",
      components: { urgency, impact, confidence, novelty, corroboration: corrob, source_boost: sourceBoost },
      weak_signal_protected: weakSignalProtected,
    },
  };
}

export function applyRelevance(signals: Signal[], scores: RelevanceScore[] | undefined): Signal[] {
  const scoreMap = new Map((scores ?? []).map((s) => [s.signal_id, s]));
  return signals.map((signal) => {
    const scored = scoreMap.get(signal.id);
    if (scored) {
      return {
        ...signal,
        relevance_score: scored.relevance_score,
        relevance_tier: scored.relevance_tier,
        relevance_reason: scored.relevance_reason,
        relevance_computed_at: scored.computed_at,
        relevance_is_fallback: false,
      };
    }
    return { ...signal, ...fallbackRelevance(signal) };
  });
}

export function mergeAndPrune(rows: Signal[]): Signal[] {
  const cutoff = Date.now() - WINDOW_MS;
  const seenIds = new Set<string>();
  const kept: Signal[] = [];
  for (const r of rows) {
    if (seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    if (new Date(r.first_detected_at).getTime() < cutoff) continue;
    kept.push(r);
  }
  kept.sort((a, b) => new Date(b.first_detected_at).getTime() - new Date(a.first_detected_at).getTime());
  return kept.slice(0, 300);
}

export const TIER_LABELS: Record<string, string> = {
  tier_1: "Tier 1 — Official / authoritative",
  tier_2: "Tier 2 — Major newswire",
  tier_3: "Tier 3 — Regional outlet",
  tier_4: "Tier 4 — General web / social",
};
