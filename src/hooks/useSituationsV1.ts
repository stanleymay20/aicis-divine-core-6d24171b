import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildSituationsV1,
  type SituationFeedbackV1,
  type SituationOutcomeV1,
  type SituationSignalV1,
  type SituationV1,
} from "@/lib/situation-read-model-v1.mjs";

const BASE_SIGNAL_COLUMNS = [
  "id",
  "title",
  "summary",
  "category",
  "status",
  "primary_source",
  "canonical_source_name",
  "source_trust_tier",
  "confidence_score",
  "impact_score",
  "urgency_score",
  "affected_countries",
  "affected_regions",
  "affected_sectors",
  "affected_stakeholders",
  "first_detected_at",
  "latest_update_at",
  "occurred_at",
  "ingested_at",
  "canonical_event_status",
  "corroboration_count",
  "multi_source_confirmed",
  "official_source_present",
  "uncertainty_notes",
  "enrichment_status",
].join(",");

const OPTIONAL_IDENTITY_COLUMNS = [
  "id",
  "canonical_event_id",
  "duplicate_of_signal_id",
  "duplicate_match_status",
].join(",");

type LooseQueryResult = {
  data: unknown[] | null;
  error: unknown;
};

interface LooseQueryBuilder {
  select(columns: string): LooseQueryBuilder;
  gte(column: string, value: string): LooseQueryBuilder;
  order(column: string, options: { ascending: boolean }): LooseQueryBuilder;
  limit(value: number): PromiseLike<LooseQueryResult>;
  in(column: string, values: string[]): PromiseLike<LooseQueryResult>;
}

interface LooseSupabaseClient {
  from(table: string): LooseQueryBuilder;
}

type SituationIdentityRow = {
  id: string;
  canonical_event_id?: string | null;
  duplicate_of_signal_id?: string | null;
  duplicate_match_status?: string | null;
};

type SituationQueryResult = {
  situations: SituationV1[];
  sourceSignalCount: number;
  dataGaps: string[];
  identityContractAvailable: boolean;
  feedbackAvailable: boolean;
  operationalOutcomeAvailable: boolean;
};

const looseSupabase = supabase as unknown as LooseSupabaseClient;

const rowsAs = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? value as T[] : [];

export function useSituationsV1(options?: { days?: number; limit?: number }) {
  const days = Math.max(1, Math.min(options?.days ?? 7, 30));
  const limit = Math.max(1, Math.min(options?.limit ?? 300, 1000));

  return useQuery<SituationQueryResult>({
    queryKey: ["situations-v1", days, limit],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const dataGaps: string[] = [];

      const { data: baseSignals, error: signalError } = await looseSupabase
        .from("global_signals")
        .select(BASE_SIGNAL_COLUMNS)
        .gte("first_detected_at", since)
        .order("first_detected_at", { ascending: false })
        .limit(limit);

      if (signalError) throw signalError;

      const signals = rowsAs<SituationSignalV1>(baseSignals).map((row) => ({ ...row }));
      const signalIds = signals.map((row) => row.id).filter(Boolean);

      let identityContractAvailable = false;
      if (signalIds.length > 0) {
        const { data: identityRows, error: identityError } = await looseSupabase
          .from("global_signals")
          .select(OPTIONAL_IDENTITY_COLUMNS)
          .in("id", signalIds);

        if (identityError) {
          dataGaps.push("verified duplicate-target identity columns unavailable; duplicate reports remain separate when target identity cannot be proven");
        } else {
          identityContractAvailable = true;
          const identityById = new Map(
            rowsAs<SituationIdentityRow>(identityRows).map((row) => [row.id, row] as const),
          );
          for (const signal of signals) {
            const identity = identityById.get(signal.id);
            if (!identity) continue;
            signal.canonical_event_id = identity.canonical_event_id ?? null;
            signal.duplicate_of_signal_id = identity.duplicate_of_signal_id ?? null;
            signal.duplicate_match_status = identity.duplicate_match_status ?? null;
          }
        }
      }

      let feedback: SituationFeedbackV1[] = [];
      let outcomes: SituationOutcomeV1[] = [];
      let feedbackAvailable = true;
      let operationalOutcomeAvailable = true;

      if (signalIds.length > 0) {
        const [feedbackResult, outcomeResult] = await Promise.all([
          looseSupabase
            .from("signal_routing_feedback")
            .select("signal_id,feedback,created_at")
            .in("signal_id", signalIds),
          looseSupabase
            .from("decision_outcome_log")
            .select("signal_id,action_taken,outcome_success,execution_status,evidence_type,outcome_timestamp")
            .in("signal_id", signalIds),
        ]);

        if (feedbackResult.error) {
          feedbackAvailable = false;
          dataGaps.push("routing feedback unavailable; review state shown as unreviewed rather than inferred");
        } else {
          feedback = rowsAs<SituationFeedbackV1>(feedbackResult.data);
        }

        if (outcomeResult.error) {
          operationalOutcomeAvailable = false;
          dataGaps.push("operational decision/outcome records unavailable; outcome state remains not recorded in this projection");
        } else {
          outcomes = rowsAs<SituationOutcomeV1>(outcomeResult.data);
        }
      }

      return {
        situations: buildSituationsV1({ signals, feedback, outcomes }),
        sourceSignalCount: signals.length,
        dataGaps,
        identityContractAvailable,
        feedbackAvailable,
        operationalOutcomeAvailable,
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
