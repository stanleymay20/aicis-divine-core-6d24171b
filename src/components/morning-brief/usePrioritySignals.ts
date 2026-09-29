import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database as DB } from "@/integrations/supabase/types";

type SignalRow = DB["public"]["Tables"]["global_signals"]["Row"];
export type PriorityBase = Pick<
  SignalRow,
  | "id"
  | "title"
  | "summary"
  | "category"
  | "impact_score"
  | "urgency_score"
  | "confidence_score"
  | "affected_sectors"
  | "affected_regions"
  | "affected_countries"
  | "strategic_implications"
  | "recommended_actions"
  | "first_detected_at"
  | "latest_update_at"
  | "source_trust_tier"
  | "source_count"
  | "primary_source"
  | "impact_reasoning"
  | "uncertainty_notes"
  | "likely_consequences"
  | "official_source"
  | "multi_source_confirmed"
>;

export type Urgency = "critical" | "high" | "medium";

export type PrioritySignal = PriorityBase & {
  urgency: Urgency;
  proposedAction: string | null;
  reviewWindow: string;
};

export const RECENT_WINDOW_DAYS = 14;

const SELECT_COLUMNS =
  "id, title, summary, category, impact_score, urgency_score, confidence_score, affected_sectors, affected_regions, affected_countries, strategic_implications, recommended_actions, first_detected_at, latest_update_at, source_trust_tier, source_count, primary_source, impact_reasoning, uncertainty_notes, likely_consequences, official_source, multi_source_confirmed";

export const urgencyFromScore = (impact: number, urgency: number): Urgency => {
  const combined = impact * 0.6 + urgency * 0.4;
  if (combined >= 80) return "critical";
  if (combined >= 60) return "high";
  return "medium";
};

const deriveReviewWindow = (urgency: Urgency): string => {
  if (urgency === "critical") return "today";
  if (urgency === "high") return "within 48 hours";
  return "this week";
};

const extractProposedAction = (
  value: PriorityBase["recommended_actions"],
): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["business", "government", "general"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
};

const toPrioritySignal = (signal: PriorityBase): PrioritySignal => {
  const urgency = urgencyFromScore(signal.impact_score, signal.urgency_score);
  return {
    ...signal,
    urgency,
    proposedAction: extractProposedAction(signal.recommended_actions),
    reviewWindow: deriveReviewWindow(urgency),
  };
};

export type PriorityResult = { signals: PrioritySignal[]; stale: boolean };

/**
 * Priority signals for the brief. Prefers signals first detected within the
 * recent window so old headlines cannot pose as today's news; falls back to
 * the newest on record (marked stale) when nothing recent qualifies.
 */
export function usePrioritySignals(limit = 5) {
  return useQuery<PriorityResult>({
    queryKey: ["priority-decisions", limit],
    queryFn: async () => {
      const windowStart = new Date(
        Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      const recent = await supabase
        .from("global_signals")
        .select(SELECT_COLUMNS)
        .eq("enrichment_status", "enriched")
        .gte("impact_score", 60)
        .gte("first_detected_at", windowStart)
        .order("impact_score", { ascending: false })
        .order("urgency_score", { ascending: false })
        .limit(limit);

      if (recent.error) throw recent.error;
      if ((recent.data ?? []).length > 0) {
        return {
          signals: (recent.data as PriorityBase[]).map(toPrioritySignal),
          stale: false,
        };
      }

      const fallback = await supabase
        .from("global_signals")
        .select(SELECT_COLUMNS)
        .eq("enrichment_status", "enriched")
        .gte("impact_score", 60)
        .order("first_detected_at", { ascending: false })
        .order("impact_score", { ascending: false })
        .limit(limit);

      if (fallback.error) throw fallback.error;
      return {
        signals: ((fallback.data ?? []) as PriorityBase[]).map(toPrioritySignal),
        stale: true,
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export const formatSignalAge = (iso: string | null): string => {
  if (!iso) return "date unknown";
  const days = Math.floor(
    (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000),
  );
  const date = iso.slice(0, 10);
  if (days <= 0) return `${date} · today`;
  if (days === 1) return `${date} · 1d old`;
  return `${date} · ${days}d old`;
};
