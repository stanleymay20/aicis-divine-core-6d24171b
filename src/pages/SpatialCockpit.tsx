import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OperationalRibbon } from "@/components/spatial-cockpit/OperationalRibbon";
import { SpatialMapPanel, CountryPoint } from "@/components/spatial-cockpit/SpatialMapPanel";
import { EventRail } from "@/components/spatial-cockpit/EventRail";
import { SimulationTimeline } from "@/components/spatial-cockpit/SimulationTimeline";
import { IntelligenceDrawer } from "@/components/spatial-cockpit/IntelligenceDrawer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Spatial Cockpit (Phase 1) — 5-panel ops surface:
 *   Top:    OperationalRibbon (live metrics)
 *   Center: SpatialMapPanel (MapLibre choropleth-as-circles)
 *   Right:  EventRail (filtered live signals)
 *   Bottom: SimulationTimeline (date scrubber)
 *   Slide:  IntelligenceDrawer (country dossier)
 */
export default function SpatialCockpit() {
  const [iso3, setIso3] = useState<string | null>(null);
  const [daysBack, setDaysBack] = useState(0);

  // Country centroids: avg lat/lon from admin_regions (subnational), one row per iso3
  const { data: centroids } = useQuery({
    queryKey: ["spatial-cockpit-centroids"],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_regions")
        .select("country_iso3,lat,lon")
        .not("lat", "is", null)
        .not("lon", "is", null)
        .limit(20000);
      const m = new Map<string, { lat: number; lon: number; n: number }>();
      (data ?? []).forEach((r: any) => {
        const c = m.get(r.country_iso3) ?? { lat: 0, lon: 0, n: 0 };
        c.lat += Number(r.lat); c.lon += Number(r.lon); c.n += 1;
        m.set(r.country_iso3, c);
      });
      const out = new Map<string, { lat: number; lon: number }>();
      m.forEach((v, k) => out.set(k, { lat: v.lat / v.n, lon: v.lon / v.n }));
      return out;
    },
  });

  // Risk snapshot for the selected day
  const { data: snapshots, isLoading } = useQuery({
    queryKey: ["spatial-cockpit-snap", daysBack],
    staleTime: 60_000,
    queryFn: async () => {
      const d = new Date();
      d.setDate(d.getDate() - daysBack);
      const day = d.toISOString().split("T")[0];
      // Find latest snapshot ≤ selected day
      const { data: latest } = await supabase
        .from("country_performance_snapshots")
        .select("snapshot_date")
        .lte("snapshot_date", day)
        .order("snapshot_date", { ascending: false })
        .limit(1);
      const targetDay = (latest?.[0] as any)?.snapshot_date ?? day;
      const { data } = await supabase
        .from("country_performance_snapshots")
        .select("iso3,risk_pressure_score")
        .eq("snapshot_date", targetDay);
      const m = new Map<string, { sum: number; n: number }>();
      (data ?? []).forEach((r: any) => {
        const c = m.get(r.iso3) ?? { sum: 0, n: 0 };
        c.sum += Number(r.risk_pressure_score ?? 0); c.n += 1;
        m.set(r.iso3, c);
      });
      const out = new Map<string, number>();
      m.forEach((v, k) => out.set(k, v.sum / v.n));
      return out;
    },
  });

  const points: CountryPoint[] = useMemo(() => {
    if (!centroids || !snapshots) return [];
    const arr: CountryPoint[] = [];
    centroids.forEach((c, iso) => {
      const r = snapshots.get(iso);
      if (r == null) return;
      arr.push({ iso3: iso, name: iso, lon: c.lon, lat: c.lat, risk: r });
    });
    return arr;
  }, [centroids, snapshots]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <OperationalRibbon />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 p-2">
          {isLoading && !points.length ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <SpatialMapPanel points={points} selectedIso3={iso3} onSelect={setIso3} />
          )}
        </main>
        <div className="hidden w-80 shrink-0 md:block">
          <EventRail selectedIso3={iso3} onSelect={setIso3} />
        </div>
      </div>
      <SimulationTimeline value={daysBack} onChange={setDaysBack} />
      <IntelligenceDrawer iso3={iso3} onClose={() => setIso3(null)} />
    </div>
  );
}
