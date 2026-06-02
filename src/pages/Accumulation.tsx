import { useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Database, TrendingUp, Activity, Globe, Sparkles } from "lucide-react";
import { PanelBoundary } from "@/components/ui/panel-boundary";
import { KPI, SkeletonGrid, fmt, ageHours } from "@/components/accumulation/atoms";
import { DomainCard } from "@/components/accumulation/DomainCard";
import { ProvidersTab } from "@/components/accumulation/ProvidersTab";
import { StorageTab } from "@/components/accumulation/StorageTab";
import { useAccumulationData } from "@/components/accumulation/queries";

export default function Accumulation() {
  const { data, isLoading } = useAccumulationData();
  const domains = data?.domains ?? [];
  const daily = data?.daily ?? [];
  const providers = data?.providers ?? [];
  const tables = data?.tables ?? [];

  const totalRows = useMemo(() => tables.reduce((s, t) => s + t.rows, 0), [tables]);
  const freshDomains = domains.filter(d => ageHours(d.last_write) < 26).length;
  const totalDomains = domains.length;
  const totalCountries = useMemo(() => Math.max(...domains.map(d => d.countries), 0), [domains]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Live Data Accumulation</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Every signal we ingest, in plain English. Click any domain to query it.
          </p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Total signals" value={fmt(totalRows)} icon={Database} />
          <KPI label="Active domains" value={`${totalDomains}`} sub={`${freshDomains} fresh`} icon={Activity} />
          <KPI label="Countries covered" value={`${totalCountries}`} icon={Globe} />
          <KPI label="Live providers" value={`${providers.length}`} sub="streams" icon={TrendingUp} />
        </div>

        <Tabs defaultValue="domains" className="space-y-4">
          <TabsList>
            <TabsTrigger value="domains">By domain</TabsTrigger>
            <TabsTrigger value="providers">By source</TabsTrigger>
            <TabsTrigger value="storage">Storage breakdown</TabsTrigger>
          </TabsList>

          <TabsContent value="domains" className="space-y-3">
            {isLoading ? (
              <PanelBoundary><SkeletonGrid /></PanelBoundary>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {domains.slice().sort((a, b) => b.rows - a.rows).map((d) => (
                  <PanelBoundary key={d.domain}>
                    <DomainCard stat={d} series={daily.find((x) => x.domain === d.domain)?.series ?? []} />
                  </PanelBoundary>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="providers" className="space-y-3">
            <PanelBoundary><ProvidersTab providers={providers} /></PanelBoundary>
          </TabsContent>

          <TabsContent value="storage" className="space-y-3">
            <PanelBoundary><StorageTab tables={tables} totalRows={totalRows} /></PanelBoundary>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
