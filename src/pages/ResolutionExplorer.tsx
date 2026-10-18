import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { iso3Of, resolutionCountryPath } from "@/lib/country-navigation-v1.mjs";
import { COUNTRY_NAMES } from "@/components/risk-atlas/countryNames";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { GlobalOverview } from "@/components/resolution/GlobalOverview";
import { CountryDrilldown } from "@/components/resolution/CountryDrilldown";
import { RegionDrilldown } from "@/components/resolution/RegionDrilldown";
import { ResolutionBreadcrumb } from "@/components/resolution/ResolutionBreadcrumb";
import { AnalysisWorkspaceNav } from "@/components/analysis/AnalysisWorkspaceNav";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";

export type ResolutionLevel = "global" | "country" | "region" | "village";

export interface DrillState {
  level: ResolutionLevel;
  countryIso3?: string;
  countryName?: string;
  regionId?: string;
  regionName?: string;
}

export default function ResolutionExplorer() {
  const { selectEntity } = useIntelligenceOS();
  const navigate = useNavigate();
  const location = useLocation();
  const [drill, setDrill] = useState<DrillState>({ level: "global" });
  const [regionLookupNotice, setRegionLookupNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const countryIso3 = iso3Of(params.get("country"));
    setRegionLookupNotice(null);
    if (!countryIso3) {
      setDrill({ level: "global" });
      return;
    }
    const countryName = COUNTRY_NAMES[countryIso3] || countryIso3;
    setDrill({ level: "country", countryIso3, countryName });
    const id = params.get("regionId");
    const name = params.get("regionName");
    if (!id && !name) return;
    let cancelled = false;
    const findRegion = async () => {
      // A free-text region badge is NOT an administrative ID. Resolve uniquely
      // within the selected country or leave the user in the country explorer.
      let query = supabase.from("admin_regions")
        .select("id,name,country_iso3")
        .eq("country_iso3", countryIso3);
      if (id) query = query.eq("id", id);
      else if (name) query = query.eq("name", name);
      const { data, error } = await query.limit(2);
      if (cancelled) return;
      if (error) {
        setRegionLookupNotice("Region lookup unavailable; choose an available region from the country explorer.");
      } else if (data?.length === 1) {
        setDrill({ level: "region", countryIso3, countryName, regionId: data[0].id, regionName: data[0].name });
      } else {
        setRegionLookupNotice(data?.length ? "Region name is ambiguous; select the intended region below." : "No exact administrative-region match; select a verified region below.");
      }
    };
    void findRegion();
    return () => { cancelled = true; };
  }, [location.search]);

  const goGlobal = () => {
    setDrill({ level: "global" });
    navigate("/resolution");
  };

  const goCountry = (iso3: string, name: string) => {
    const path = resolutionCountryPath(iso3);
    if (!path) return;
    setRegionLookupNotice(null);
    setDrill({ level: "country", countryIso3: iso3, countryName: name });
    navigate(path);
    selectEntity({
      id: iso3,
      type: "country",
      name,
      geography: {
        country: name,
      },
      metadata: {
        iso3,
      },
    });
  };

  const goRegion = (regionId: string, regionName: string) => {
    if (!drill.countryIso3) return;
    navigate(`/resolution?country=${encodeURIComponent(drill.countryIso3)}&regionId=${encodeURIComponent(regionId)}`);
    setDrill((prev) => ({
      ...prev,
      level: "region",
      regionId,
      regionName,
    }));
    selectEntity({
      id: regionId,
      type: "region",
      name: regionName,
      geography: {
        country: drill.countryName ?? drill.countryIso3,
        region: regionName,
      },
      metadata: {
        countryIso3: drill.countryIso3 ?? null,
        regionId,
      },
    });
  };

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto overflow-y-auto h-full">
        <AnalysisWorkspaceNav />

        <div className="space-y-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            Country & Region Risk Map
          </h1>
          <p className="text-sm text-muted-foreground">
            See where your supply chain is most exposed — drill from market level to region to local risk
          </p>
        </div>

        <ResolutionBreadcrumb drill={drill} onGlobal={goGlobal} onCountry={goCountry} />
        {regionLookupNotice && <p role="status" className="rounded-md border border-amber-500/30 px-3 py-2 text-xs text-amber-300">{regionLookupNotice}</p>}

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
