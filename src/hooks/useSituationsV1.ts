import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildSituationsV1,
  type SituationFeedbackV1,
  type SituationOutcomeV1,
  type SituationSignalV1,
  type SituationV1,
} from "@/lib/situation-read-model-v1.mjs";
import {
  buildSituationWindowMetaV1,
  classifySituationReadErrorV1,
} from "@/lib/situation-query-contract-v1.mjs";

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
  count?: number | null;
};

type LooseSelectOptions = {
  count?: "exact";
  head?: boolean;
};

interface LooseQueryBuilder extends PromiseLike<LooseQueryResult> {
  select(columns: string, options?: LooseSelectOptions): LooseQueryBuilder;
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

type SituationReadAccessState = "available" | "access_denied" | "unavailable" | "not_needed";

type SituationWindowCoverageState =
  | "complete_window"
  | "capped_sample"
  | "cap_reached_total_unknown"
  | "total_unknown"
  | "count_inconsistent";

type SituationWindowMeta = {
  lookbackDays: number;
  rowLimit: number;
  returnedSignalRows: number;
  totalSignalRows: number | null;
  queryLatencyMs: number | null;
  coverageState: SituationWindowCoverageState;
};

type SituationQueryResult = {
  situations: SituationV1[];
  sourceSignalCount: number;
  dataGaps: string[];
  identityContractAvailable: boolean;
  feedbackAvailable: boolean;
  operationalOutcomeAvailable: boolean;
  window: SituationWindowMeta;
  accessStates: {
    signalWindow: SituationReadAccessState;
    exactCount: SituationReadAccessState;
    identity: SituationReadAccessState;
    feedback: SituationReadAccessState;
    operationalOutcome: SituationReadAccessState;
  };
};

class SituationSignalReadError extends Error {
  accessState: SituationReadAccessState;

  constructor(accessState: SituationReadAccessState) {
    super(
      accessState === "access_denied"
        ? "Signal window read blocked by authentication or RLS policy."
        : "Signal window read is currently unavailable.",
    );
    this.name = "SituationSignalReadError";
    this.accessState = accessState;
  }
}

const looseSupabase = supabase as unknown as LooseSupabaseClient;

const rowsAs = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? value as T[] : [];

const readStateForError = (error: unknown): SituationReadAccessState =>
  classifySituationReadErrorV1(error) as SituationReadAccessState;

export function useSituationsV1(options?: { days?: number; limit?: number }) {
  const days = Math.max(1, Math.min(options?.days ?? 7, 30));
  const limit = Math.max(1, Math.min(options?.limit ?? 300, 1000));

  return useQuery<SituationQueryResult>({
    queryKey: ["situations-v1", days, limit],
    queryFn: async () => {
      const startedAt = Date.now();
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const dataGaps: string[] = [];

      // Count and row reads are intentionally independent and read-only. The exact
      // count tells the UI whether the configured row cap is a complete window or
      // merely a recent sample; failure of the count must not hide valid signal rows.
      const [countResult, signalResult] = await Promise.all([
        looseSupabase
          .from("global_signals")
          .select("id", { count: "exact", head: true })
          .gte("first_detected_at", since),
        looseSupabase
          .from("global_signals")
          .select(BASE_SIGNAL_COLUMNS)
          .gte("first_detected_at", since)
          .order("first_detected_at", { ascending: false })
          .limit(limit),
      ]);

      if (signalResult.error) {
        throw new SituationSignalReadError(readStateForError(signalResult.error));
      }

      let exactCountAccess: SituationReadAccessState = "available";
      let totalSignalRows: number | null = null;
      if (countResult.error) {
        exactCountAccess = readStateForError(countResult.error);
        dataGaps.push(
          exactCountAccess === "access_denied"
            ? "exact lookback row count blocked by auth/RLS; loaded rows remain bounded and total window coverage is unknown"
            : "exact lookback row count unavailable; loaded rows remain bounded and total window coverage is unknown",
        );
      } else if (typeof countResult.count === "number" && Number.isFinite(countResult.count)) {
        totalSignalRows = Math.max(0, Math.trunc(countResult.count));
      } else {
        exactCountAccess = "unavailable";
        dataGaps.push("exact lookback row count was not returned; total window coverage remains unknown");
      }

      const signals = rowsAs<SituationSignalV1>(signalResult.data).map((row) => ({ ...row }));
      const signalIds = signals.map((row) => row.id).filter(Boolean);

      let identityContractAvailable = false;
      let identityAccess: SituationReadAccessState = signalIds.length > 0 ? "unavailable" : "not_needed";
      if (signalIds.length > 0) {
        const { data: identityRows, error: identityError } = await looseSupabase
          .from("global_signals")
          .select(OPTIONAL_IDENTITY_COLUMNS)
          .in("id", signalIds);

        if (identityError) {
          identityAccess = readStateForError(identityError);
          dataGaps.push(
            identityAccess === "access_denied"
              ? "verified duplicate-target identity read blocked by auth/RLS; duplicate reports remain separate when target identity cannot be proven"
              : "verified duplicate-target identity columns unavailable; duplicate reports remain separate when target identity cannot be proven",
          );
        } else {
          identityContractAvailable = true;
          identityAccess = "available";
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
      let feedbackAvailable = signalIds.length === 0;
      let operationalOutcomeAvailable = signalIds.length === 0;
      let feedbackAccess: SituationReadAccessState = signalIds.length > 0 ? "unavailable" : "not_needed";
      let outcomeAccess: SituationReadAccessState = signalIds.length > 0 ? "unavailable" : "not_needed";

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
          feedbackAccess = readStateForError(feedbackResult.error);
          dataGaps.push(
            feedbackAccess === "access_denied"
              ? "routing feedback read blocked by auth/RLS; review state is shown as unreviewed rather than interpreted as no feedback"
              : "routing feedback unavailable; review state is shown as unreviewed rather than inferred",
          );
        } else {
          feedbackAvailable = true;
          feedbackAccess = "available";
          feedback = rowsAs<SituationFeedbackV1>(feedbackResult.data);
        }

        if (outcomeResult.error) {
          operationalOutcomeAvailable = false;
          outcomeAccess = readStateForError(outcomeResult.error);
          dataGaps.push(
            outcomeAccess === "access_denied"
              ? "operational decision/outcome read blocked by auth/RLS; outcome state remains not recorded rather than interpreted as no operational record"
              : "operational decision/outcome records unavailable; outcome state remains not recorded in this projection",
          );
        } else {
          operationalOutcomeAvailable = true;
          outcomeAccess = "available";
          outcomes = rowsAs<SituationOutcomeV1>(outcomeResult.data);
        }
      }

      const window = buildSituationWindowMetaV1({
        lookbackDays: days,
        rowLimit: limit,
        returnedSignalRows: signals.length,
        totalSignalRows,
        queryLatencyMs: Date.now() - startedAt,
      }) as SituationWindowMeta;

      return {
        situations: buildSituationsV1({ signals, feedback, outcomes }),
        sourceSignalCount: signals.length,
        dataGaps,
        identityContractAvailable,
        feedbackAvailable,
        operationalOutcomeAvailable,
        window,
        accessStates: {
          signalWindow: "available",
          exactCount: exactCountAccess,
          identity: identityAccess,
          feedback: feedbackAccess,
          operationalOutcome: outcomeAccess,
        },
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
