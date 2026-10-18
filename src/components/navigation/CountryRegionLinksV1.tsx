import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  countryDeepDivePath, resolutionCountryPath, resolutionRegionPath, iso3Of,
} from "@/lib/country-navigation-v1.mjs";

type Props = {
  countries?: string[] | null;
  regions?: string[] | null;
  max?: number;
};

export function CountryRegionLinksV1({ countries, regions, max = 6 }: Props) {
  const codes = [...new Set((countries ?? []).map(iso3Of).filter((value): value is string => !!value))].slice(0, max);
  const labels = [...new Set((regions ?? []).filter((value): value is string => typeof value === "string" && !!value.trim()).map((value) => value.trim()))].slice(0, max);
  if (!codes.length && !labels.length) return null;
  // A region name without a unique country anchor is ambiguous: show it, but don't navigate.
  const parentCountry = codes.length === 1 ? codes[0] : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Affected geographic context">
      {codes.map((code) => (
        <span key={code} className="inline-flex items-center gap-1 text-[10px]">
          <Link className="rounded border border-primary/35 px-2 py-0.5 text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2" to={countryDeepDivePath(code)!} aria-label={`Country deep dive for ${code}`}>{code} profile</Link>
          <Link className="rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2" to={resolutionCountryPath(code)!} aria-label={`Resolution Explorer for ${code}`}>regions</Link>
        </span>
      ))}
      {labels.map((name) => {
        const href = parentCountry ? resolutionRegionPath(parentCountry, name) : null;
        return href ? (
          <Link key={name} to={href} className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/10 focus-visible:outline focus-visible:outline-2" title={`Find verified administrative region ${name} in ${parentCountry}; no region ID is inferred`}>{name} · locate region</Link>
        ) : (
          <Badge key={name} variant="outline" className="text-[10px]" title="Region has no uniquely identified country; direct navigation withheld">{name} · country unknown</Badge>
        );
      })}
    </div>
  );
}
