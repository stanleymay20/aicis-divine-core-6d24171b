import { useState, useMemo } from "react";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { useGlobalSignals, useTopSignals } from "@/hooks/useGlobalSignals";
import type { GlobalSignal } from "@/hooks/useGlobalSignals";
import { SignalCard } from "@/components/live/SignalCard";
import { SignalDetailPanel } from "@/components/live/SignalDetailPanel";
import { AlertRibbon } from "@/components/live/AlertRibbon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Radio, Globe, TrendingUp, Shield, Search, RefreshCw, Loader2, Zap
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type AudienceMode = "government" | "media" | "business" | "public";

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "geopolitical", label: "Geopolitical" },
  { value: "economic", label: "Economic" },
  { value: "financial_markets", label: "Financial Markets" },
  { value: "central_banking", label: "Central Banking" },
  { value: "public_health", label: "Public Health" },
  { value: "climate_disaster", label: "Climate / Disaster" },
  { value: "energy", label: "Energy" },
  { value: "technology", label: "Technology" },
  { value: "cybersecurity", label: "Cybersecurity" },
  { value: "defense_conflict", label: "Defense / Conflict" },
  { value: "legal_regulatory", label: "Legal / Regulatory" },
  { value: "supply_chain", label: "Supply Chain" },
  { value: "elections", label: "Elections" },
  { value: "social_unrest", label: "Social Unrest" },
  { value: "infrastructure", label: "Infrastructure" },
];

export default function LiveCommandFeed() {
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("government");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSignal, setSelectedSignal] = useState<GlobalSignal | null>(null);
  const [ingesting, setIngesting] = useState(false);

  const { data: allSignals = [], isLoading, refetch } = useGlobalSignals({ limit: 100 });
  const { data: topSignals = [] } = useTopSignals(5);
  const { toast } = useToast();

  const filteredSignals = useMemo(() => {
    let signals = allSignals;
    if (categoryFilter !== "all") {
      signals = signals.filter(s => s.category === categoryFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      signals = signals.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.affected_regions?.some(r => r.toLowerCase().includes(q)) ||
        s.affected_sectors?.some(sec => sec.toLowerCase().includes(q))
      );
    }
    return signals;
  }, [allSignals, categoryFilter, searchQuery]);

  const triggerIngestion = async () => {
    setIngesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("ingest-global-signals");
      if (error) throw error;
      toast({
        title: "Ingestion complete",
        description: `${data?.new_signals || 0} new signals, ${data?.high_impact_routed || 0} routed to decisions`,
      });
      refetch();
    } catch (e: any) {
      toast({ title: "Ingestion failed", description: e.message, variant: "destructive" });
    } finally {
      setIngesting(false);
    }
  };

  // Stats
  const highImpactCount = allSignals.filter(s => s.impact_score >= 75).length;
  const avgConfidence = allSignals.length > 0
    ? Math.round(allSignals.reduce((s, sig) => s + sig.confidence_score, 0) / allSignals.length)
    : 0;
  const confirmedCount = allSignals.filter(s => s.multi_source_confirmed).length;

  // Staleness check
  const latestSignalTime = allSignals.length > 0 
    ? new Date(allSignals[0].first_detected_at).getTime() 
    : 0;
  const hoursSinceLatest = latestSignalTime ? (Date.now() - latestSignalTime) / (1000 * 60 * 60) : 999;
  const isStale = hoursSinceLatest > 4;

  return (
    <AICISLayout>
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-3 sm:p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-red-500 animate-pulse" />
              <div>
                <h1 className="text-base sm:text-lg font-semibold">AICIS Live Command Feed</h1>
                <p className="text-[10px] sm:text-xs text-muted-foreground">
                  Real-time global signal intelligence • {allSignals.length} signals tracked
                  {latestSignalTime > 0 && (
                    <span className={cn("ml-1", isStale ? "text-red-400" : "text-emerald-400")}>
                      • Last: {Math.round(hoursSinceLatest)}h ago
                    </span>
                  )}
                </p>
              </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={triggerIngestion}
              disabled={ingesting}
            >
              {ingesting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              {ingesting ? "Ingesting…" : "Ingest Now"}
            </Button>
          </div>

          {/* KPI Bar */}
          <div className="grid grid-cols-4 gap-2">
            <Card className="p-2 text-center">
              <div className="text-lg font-bold font-mono">{allSignals.length}</div>
              <div className="text-[9px] text-muted-foreground">Total Signals</div>
            </Card>
            <Card className="p-2 text-center">
              <div className="text-lg font-bold font-mono text-red-400">{highImpactCount}</div>
              <div className="text-[9px] text-muted-foreground">High Impact</div>
            </Card>
            <Card className="p-2 text-center">
              <div className="text-lg font-bold font-mono">{avgConfidence}%</div>
              <div className="text-[9px] text-muted-foreground">Avg Confidence</div>
            </Card>
            <Card className="p-2 text-center">
              <div className="text-lg font-bold font-mono text-primary">{topSignals.length}</div>
              <div className="text-[9px] text-muted-foreground">Top Priority</div>
            </Card>
          </div>

          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Tabs value={audienceMode} onValueChange={v => setAudienceMode(v as AudienceMode)} className="w-full sm:w-auto">
              <TabsList className="h-8 w-full sm:w-auto">
                <TabsTrigger value="government" className="text-[10px] px-2 h-6">
                  <Shield className="h-3 w-3 mr-0.5" /> Gov
                </TabsTrigger>
                <TabsTrigger value="media" className="text-[10px] px-2 h-6">
                  <Radio className="h-3 w-3 mr-0.5" /> Media
                </TabsTrigger>
                <TabsTrigger value="business" className="text-[10px] px-2 h-6">
                  <TrendingUp className="h-3 w-3 mr-0.5" /> Business
                </TabsTrigger>
                <TabsTrigger value="public" className="text-[10px] px-2 h-6">
                  <Globe className="h-3 w-3 mr-0.5" /> Public
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex gap-2 flex-1">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 text-xs flex-1 sm:max-w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search signals..."
                  className="h-8 text-xs pl-7"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Signal List */}
          <div className={cn(
            "flex-1 overflow-hidden flex flex-col",
            selectedSignal && "hidden sm:flex sm:max-w-[55%]"
          )}>
            <ScrollArea className="flex-1 p-3">
              <div className="space-y-3">
                {/* Alert Ribbon */}
                <AlertRibbon signals={allSignals} />

                {/* Top Signals Section */}
                {topSignals.length > 0 && !categoryFilter.startsWith("all") === false && !searchQuery && (
                  <div className="space-y-2">
                    <h2 className="text-xs font-semibold flex items-center gap-1 text-primary">
                      <Zap className="h-3.5 w-3.5" /> Top Global Signals
                    </h2>
                    {topSignals.map(s => (
                      <SignalCard
                        key={s.id}
                        signal={s}
                        audienceMode={audienceMode}
                        onSelect={setSelectedSignal}
                        selected={selectedSignal?.id === s.id}
                      />
                    ))}
                  </div>
                )}

                {/* Full Feed */}
                <div className="space-y-2">
                  <h2 className="text-xs font-semibold text-muted-foreground">
                    {searchQuery || categoryFilter !== "all" ? "Filtered" : "All"} Signals ({filteredSignals.length})
                  </h2>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : filteredSignals.length === 0 ? (
                    <Card className="p-6 text-center">
                      <Globe className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                      <p className="text-sm text-muted-foreground">No signals found</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        Click "Ingest Now" to pull latest global events
                      </p>
                    </Card>
                  ) : (
                    filteredSignals.map(s => (
                      <SignalCard
                        key={s.id}
                        signal={s}
                        audienceMode={audienceMode}
                        onSelect={setSelectedSignal}
                        selected={selectedSignal?.id === s.id}
                      />
                    ))
                  )}
                </div>
              </div>
            </ScrollArea>
          </div>

          {/* Detail Panel */}
          {selectedSignal && (
            <div className={cn(
              "w-full sm:w-[45%] sm:max-w-[400px] border-l",
              "absolute sm:relative inset-0 sm:inset-auto bg-background z-10"
            )}>
              <SignalDetailPanel
                signal={selectedSignal}
                audienceMode={audienceMode}
                onClose={() => setSelectedSignal(null)}
              />
            </div>
          )}
        </div>
      </div>
    </AICISLayout>
  );
}
