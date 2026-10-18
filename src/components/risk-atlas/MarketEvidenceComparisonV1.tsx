import { AlertTriangle, BarChart3, Loader2 } from "lucide-react";
import { useMarketEvidenceComparisonV1 } from "@/hooks/useMarketEvidenceComparisonV1";
import { COUNTRY_NAMES } from "./countryNames";

const display = (value: number, unit: string | null) =>
  `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}${unit ? ` ${unit}` : ""}`;

export function MarketEvidenceComparisonV1({ countryA, countryB }: { countryA: string; countryB: string }) {
  const query = useMarketEvidenceComparisonV1(countryA, countryB);
  const result = query.data;
  const a = COUNTRY_NAMES[countryA] || countryA;
  const b = COUNTRY_NAMES[countryB] || countryB;

  return (
    <section className="space-y-2 rounded-lg border border-border bg-background/60 p-3" aria-label="Country market evidence comparison">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" aria-hidden />
        <h3 className="text-xs font-semibold">Country market evidence</h3>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Read-only normalized observations, not a market-potential index, recommendation or forecast. Values are comparable only when metric, period, unit and provider match.
      </p>
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking available observations…
        </div>
      ) : query.error ? (
        <div className="flex items-start gap-1.5 text-xs text-amber-400" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Evidence unavailable. The country-metric read failed; no comparison can be verified.
        </div>
      ) : !result || result.indicators.length === 0 ? (
        <p className="text-xs text-muted-foreground">No shared or country-only normalized indicators found in the bounded visible sample. This does not establish that no data exists.</p>
      ) : (
        <>
          <div className="text-[10px] text-muted-foreground">
            Visible sample: {a} {result.sample.loadedA}/{result.sample.limitPerCountry} rows; {b} {result.sample.loadedB}/{result.sample.limitPerCountry} rows. Not a completeness audit.
          </div>
          {(result.sample.capReachedA || result.sample.capReachedB) && (
            <div className="text-[10px] text-amber-400">Sample cap reached; older indicators may be omitted.</div>
          )}
          <div className="space-y-2">
            {result.indicators.map((indicator: {
              metric: string;
              domain: string;
              state: string;
              note: string;
              countryA: { value: number; unit: string | null; period: string; provider: string; provenance: string | null; verifiedAt: string | null } | null;
              countryB: { value: number; unit: string | null; period: string; provider: string; provenance: string | null; verifiedAt: string | null } | null;
            }) => (
              <div key={`${indicator.domain}:${indicator.metric}`} className="rounded-md border border-border/70 p-2">
                <div className="text-[11px] font-medium">{indicator.metric}</div>
                <div className="text-[10px] text-muted-foreground">Domain: {indicator.domain}</div>
                {indicator.state === "comparable" && indicator.countryA && indicator.countryB ? (
                  <>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                      <div><div className="text-muted-foreground">{a}</div><div className="font-mono">{display(indicator.countryA.value, indicator.countryA.unit)}</div></div>
                      <div><div className="text-muted-foreground">{b}</div><div className="font-mono">{display(indicator.countryB.value, indicator.countryB.unit)}</div></div>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {indicator.countryA.period} · {indicator.countryA.provider} · descriptive comparison only
                    </p>
                    {(indicator.countryA.provenance || indicator.countryB.provenance) && (
                      <p className="text-[10px] text-muted-foreground">
                        Reported provenance: {indicator.countryA.provenance || "unknown"} / {indicator.countryB.provenance || "unknown"}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {indicator.state.replaceAll("_", " ")} — {indicator.note}
                  </p>
                )}
              </div>
            ))}
          </div>
          {result.availableIndicatorGroups > result.displayedIndicatorGroups && (
            <p className="text-[10px] text-muted-foreground">
              Displaying {result.displayedIndicatorGroups} of {result.availableIndicatorGroups} indicator groups found in the bounded sample.
            </p>
          )}
        </>
      )}
      <p className="text-[10px] text-muted-foreground">
        No source-independence, knowledge-time validity, model calibration, data licensing, or future outcome is established by this view.
      </p>
    </section>
  );
}
