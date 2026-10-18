import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildMarketEvidenceComparison } from "@/lib/market-evidence-comparator-v1.mjs";

// Read-only and deliberately capped: AICIS cannot claim exhaustive country coverage
// or a current-year data set until independent runtime completeness proof exists.
const SAMPLE_LIMIT_PER_COUNTRY = 250;
const FIELDS = [
  "iso3", "domain", "metric_name", "period", "value", "unit",
  "provider_name", "provenance_source", "provenance_observed_at", "last_verified_at",
].join(",");

export function useMarketEvidenceComparisonV1(countryA: string, countryB: string) {
  const a = countryA.toUpperCase();
  const b = countryB.toUpperCase();
  const valid = /^[A-Z]{3}$/.test(a) && /^[A-Z]{3}$/.test(b) && a !== b;

  return useQuery({
    queryKey: ["market-evidence-comparison-v1", a, b],
    enabled: valid,
    queryFn: async () => {
      const load = async (country: string) => {
        const { data, error } = await supabase
          .from("normalized_metrics")
          .select(FIELDS)
          .eq("iso3", country)
          .order("period", { ascending: false })
          .limit(SAMPLE_LIMIT_PER_COUNTRY);
        if (error) throw new Error(`Country metric read unavailable for ${country}: ${error.message}`);
        // The generated types may not represent all optional live fields; schema drift
        // should surface as a read error, never a silent fabricated fallback.
        return data ?? [];
      };
      const [rowsA, rowsB] = await Promise.all([load(a), load(b)]);
      const comparison = buildMarketEvidenceComparison({ countryA: a, countryB: b, rowsA, rowsB });
      return {
        ...comparison,
        sample: {
          loadedA: rowsA.length,
          loadedB: rowsB.length,
          limitPerCountry: SAMPLE_LIMIT_PER_COUNTRY,
          isExhaustive: false,
          capReachedA: rowsA.length === SAMPLE_LIMIT_PER_COUNTRY,
          capReachedB: rowsB.length === SAMPLE_LIMIT_PER_COUNTRY,
        },
      };
    },
    staleTime: 60_000,
    retry: 1,
  });
}
