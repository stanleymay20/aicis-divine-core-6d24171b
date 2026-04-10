import { useState } from "react";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { GlobalOverview } from "@/components/resolution/GlobalOverview";
import { CountryDrilldown } from "@/components/resolution/CountryDrilldown";
import { RegionDrilldown } from "@/components/resolution/RegionDrilldown";
import { ResolutionBreadcrumb } from "@/components/resolution/ResolutionBreadcrumb";

export type ResolutionLevel = "global" | "country" | "region" | "village";

export interface DrillState {
  level: ResolutionLevel;
  countryIso3?: string;
  countryName?: string;
  regionId?: string;
  regionName?: string;
}

export default function ResolutionExplorer() {
  const [drill, setDrill] = useState<DrillState>({ level: "global" });

  const goGlobal = () => setDrill({ level: "global" });
  const goCountry = (iso3: string, name: string) =>
    setDrill({ level: "country", countryIso3: iso3, countryName: name });
  const goRegion = (regionId: string, regionName: string) =>
    setDrill((prev) => ({ ...prev, level: "region", regionId, regionName }));

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto overflow-y-auto h-full">
        <div className="space-y-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            Country & Region Risk Map
          </h1>
          <p className="text-sm text-muted-foreground">
            See where your supply chain is most exposed — drill from market level to region to local risk
          </p>
        </div>

        <ResolutionBreadcrumb drill={drill} onGlobal={goGlobal} onCountry={goCountry} />

        {drill.level === "global" && <GlobalOverview onSelectCountry={goCountry} />}
        {drill.level === "country" && drill.countryIso3 && (
          <CountryDrilldown
            iso3={drill.countryIso3}
            countryName={drill.countryName || drill.countryIso3}
            onSelectRegion={goRegion}
            onBack={goGlobal}
          />
        )}
        {drill.level === "region" && drill.regionId && (
          <RegionDrilldown
            regionId={drill.regionId}
            regionName={drill.regionName || "Region"}
            countryIso3={drill.countryIso3 || ""}
            onBack={() => goCountry(drill.countryIso3!, drill.countryName!)}
          />
        )}
      </div>
    </AICISLayout>
  );
}
