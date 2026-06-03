import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Citation } from "@/components/sovereign/CitationChip";

export type SubjectType =
  | "global_signals"
  | "aicis_early_warnings"
  | "risk_action_recommendations";

/**
 * Batch-fetch citations for a set of subject IDs and resolve authority tier
 * via the source_authority_registry. Returns a Map<subjectId, Citation[]>.
 *
 * This is the read path that exposes the Phase B citation backfill to the UI.
 * Without this binding, all the backfill work would remain invisible.
 */
export function useSubjectCitations(
  subjectType: SubjectType,
  subjectIds: (string | undefined | null)[],
  options?: { enabled?: boolean }
) {
  const ids = Array.from(new Set(subjectIds.filter(Boolean))) as string[];
  const enabled = (options?.enabled ?? true) && ids.length > 0;

  return useQuery({
    queryKey: ["subject-citations", subjectType, ids.sort().join(",")],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("intelligence_citations")
        .select("subject_id, source_name, source_url, confidence_weight, publisher_key, source_type")
        .eq("subject_type", subjectType)
        .in("subject_id", ids);
      if (error) throw error;

      const pubKeys = Array.from(
        new Set((rows ?? []).map((r: any) => r.publisher_key).filter(Boolean))
      );

      let tierMap = new Map<string, number>();
      if (pubKeys.length > 0) {
        const { data: auth } = await supabase
          .from("source_authority_registry")
          .select("publisher_key, authority_tier")
          .in("publisher_key", pubKeys);
        (auth ?? []).forEach((a: any) => tierMap.set(a.publisher_key, a.authority_tier));
      }

      const bySubject = new Map<string, Citation[]>();
      (rows ?? []).forEach((r: any) => {
        const c: Citation = {
          source_name: r.source_name,
          source_url: r.source_url,
          confidence_weight: r.confidence_weight,
          authority_tier:
            tierMap.get(r.publisher_key) ?? (r.source_type === "official" ? 2 : 3),
        };
        const arr = bySubject.get(r.subject_id) ?? [];
        arr.push(c);
        bySubject.set(r.subject_id, arr);
      });

      // Sort each subject's citations: tier asc, then confidence desc
      for (const arr of bySubject.values()) {
        arr.sort((a, b) => {
          const ta = a.authority_tier ?? 99;
          const tb = b.authority_tier ?? 99;
          if (ta !== tb) return ta - tb;
          return (b.confidence_weight ?? 0) - (a.confidence_weight ?? 0);
        });
      }
      return bySubject;
    },
  });
}
