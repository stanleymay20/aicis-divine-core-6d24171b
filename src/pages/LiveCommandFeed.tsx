import { useState, useMemo } from "react";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { useGlobalSignals } from "@/hooks/useGlobalSignals";
import type { GlobalSignal } from "@/hooks/useGlobalSignals";
import { SignalCard } from "@/components/live/SignalCard";
import { SignalDetailPanel } from "@/components/live/SignalDetailPanel";
import { RoutingPrecisionPanel } from "@/components/live/RoutingPrecisionPanel";
import { useEnrichmentQueue, useRoutingPrecision } from "@/hooks/useRoutingPrecision";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  Radio, Globe, TrendingUp, Shield, Search, RefreshCw, Loader2, AlertTriangle, Cpu, ClipboardCheck, Package, ChevronDown, ChevronUp
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type AudienceMode = "government" | "media" | "business" | "public";

const SUPPLY_CHAIN_CATEGORIES = [
  "energy", "supply_chain", "infrastructure", "climate_disaster",
  "defense_conflict", "geopolitical", "legal_regulatory", "public_health",
  "social_unrest", "economic",
];

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
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("business");
  const [supplyChainMode, setSupplyChainMode] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSignal, setSelectedSignal] = useState<GlobalSignal | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [feedbackCount, setFeedbackCount] = useState(0);
  const [showTools, setShowTools] = useState(false);

  const { data: allSignals = [], isLoading, refetch } = useGlobalSignals({ limit: 100 });
  const { data: pendingCount = 0 } = useEnrichmentQueue();
  const { data: precision } = useRoutingPrecision();
  const { toast } = useToast();

  const filteredSignals = useMemo(() => {
    let signals = allSignals;

    // Review mode: show only routed enriched signals
    if (reviewMode) {
      signals = signals.filter(s =>
        s.enrichment_status === "enriched" && (s.routed_at || s.impact_score >= 50)
      );
    }

    // Supply chain mode: filter to relevant categories
    if (supplyChainMode && categoryFilter === "all") {
      signals = signals.filter(s => SUPPLY_CHAIN_CATEGORIES.includes(s.category));
    }

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
  }, [allSignals, categoryFilter, searchQuery, reviewMode, supplyChainMode]);

  const triggerIngestion = async () => {
    setIngesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("ingest-global-signals");
      if (error) throw error;
      toast({
        title: "Intake complete",
        description: `${data?.new_signals || 0} new, ${data?.sources?.official || 0} official, ${data?.pending_enrichment || 0} pending`,
      });
      refetch();
      if ((data?.pending_enrichment || 0) > 0) {
        setTimeout(() => triggerEnrichment(), 2000);
      }
    } catch (e: any) {
      toast({ title: "Intake failed", description: e.message, variant: "destructive" });
    } finally {
      setIngesting(false);
    }
  };

  const triggerEnrichment = async () => {
    setEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke("enrich-global-signals");
      if (error) throw error;
      toast({
        title: "Enrichment complete",
        description: `${data?.enriched || 0} enriched, ${data?.routed || 0} routed (${data?.total_duration_ms || 0}ms)`,
      });
      refetch();
    } catch (e: any) {
      toast({ title: "Enrichment failed", description: e.message, variant: "destructive" });
    } finally {
      setEnriching(false);
    }
  };

  // Stats
  const enrichedSignals = allSignals.filter(s => s.enrichment_status === "enriched");
  const highImpactCount = enrichedSignals.filter(s => s.impact_score >= 75).length;
  const avgConfidence = enrichedSignals.length > 0
    ? Math.round(enrichedSignals.reduce((s, sig) => s + sig.confidence_score, 0) / enrichedSignals.length)
    : 0;
  const confirmedCount = allSignals.filter(s => s.multi_source_confirmed).length;
  const officialCount = allSignals.filter(s => s.official_source_present).length;

  // Staleness
  const latestSignalTime = allSignals.length > 0
    ? new Date(allSignals[0].first_detected_at).getTime() : 0;
  const hoursSinceLatest = latestSignalTime ? (Date.now() - latestSignalTime) / (1000 * 60 * 60) : 999;
  const isStale = hoursSinceLatest > 4;

  const latestEnriched = enrichedSignals.length > 0 && enrichedSignals[0].enriched_at
    ? new Date(enrichedSignals[0].enriched_at).getTime() : 0;
  const hoursSinceEnrich = latestEnriched ? (Date.now() - latestEnriched) / (1000 * 60 * 60) : 999;
  const enrichmentStale = hoursSinceEnrich > 4;

  return (
    <AICISLayout>
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-3 sm:p-4 border-b space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Radio className="h-5 w-5 text-primary" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-semibold tracking-tight">Supply Chain Risks</h1>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                  {filteredSignals.length} risks that may affect trade, logistics, and sourcing
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground border border-border rounded px-2 py-1">
                <span className={cn("h-1.5 w-1.5 rounded-full", isStale ? "bg-amber-500" : "bg-emerald-500 animate-pulse")} />
                {isStale ? `Stale ${Math.round(hoursSinceLatest)}h` : "Live"}
              </span>
              <Button size="sm" variant={reviewMode ? "default" : "outline"} className="h-8 text-xs" onClick={() => setReviewMode(!reviewMode)}>
                <ClipboardCheck className="h-3 w-3 mr-1" /> Review{reviewMode ? " ✓" : ""}
              </Button>
            </div>
          </div>

          {/* Always-visible KPI strip */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            <Card className="p-2 text-center"><div className="text-base font-bold font-mono tabular-nums">{allSignals.length}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</div></Card>
            <Card className="p-2 text-center"><div className="text-base font-bold font-mono tabular-nums text-destructive">{highImpactCount}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wide">High impact</div></Card>
            <Card className="p-2 text-center"><div className="text-base font-bold font-mono tabular-nums">{avgConfidence}%</div><div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg conf</div></Card>
            <Card className="p-2 text-center"><div className="text-base font-bold font-mono tabular-nums text-primary">{confirmedCount}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wide">Confirmed</div></Card>
            <Card className="p-2 text-center"><div className="text-base font-bold font-mono tabular-nums text-primary">{officialCount}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wide">Official</div></Card>
          </div>

          {/* Warnings */}
          {(isStale || enrichmentStale || (precision?.total === 0)) && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded px-3 py-1.5 flex items-center gap-2 text-xs text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <div className="space-x-1">
                {isStale && <span>No new signals in {Math.round(hoursSinceLatest)}h.</span>}
                {enrichmentStale && <span>Enrichment stale ({Math.round(hoursSinceEnrich)}h).</span>}
                {precision?.total === 0 && <span>Zero routing feedback — click Review to start.</span>}
              </div>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search risks by title, region, or sector…"
              className="h-8 text-xs pl-7"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <Collapsible open={showTools} onOpenChange={setShowTools}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-full justify-between text-xs text-muted-foreground">
                Audience, filters & intake tools
                {showTools ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <Tabs value={audienceMode} onValueChange={v => setAudienceMode(v as AudienceMode)} className="w-full sm:w-auto">
                  <TabsList className="h-8 w-full sm:w-auto">
                    <TabsTrigger value="government" className="text-[10px] px-2 h-6"><Shield className="h-3 w-3 mr-0.5" /> Gov</TabsTrigger>
                    <TabsTrigger value="media" className="text-[10px] px-2 h-6"><Radio className="h-3 w-3 mr-0.5" /> Media</TabsTrigger>
                    <TabsTrigger value="business" className="text-[10px] px-2 h-6"><TrendingUp className="h-3 w-3 mr-0.5" /> Business</TabsTrigger>
                    <TabsTrigger value="public" className="text-[10px] px-2 h-6"><Globe className="h-3 w-3 mr-0.5" /> Public</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex gap-2 flex-1 flex-wrap">
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-8 text-xs flex-1 min-w-[160px] sm:max-w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant={supplyChainMode ? "default" : "outline"} className="h-8 text-xs" onClick={() => setSupplyChainMode(!supplyChainMode)}>
                    <Package className="h-3 w-3 mr-1" />{supplyChainMode ? "Supply Chain" : "All"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={triggerIngestion} disabled={ingesting}>
                    {ingesting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}{ingesting ? "…" : "Ingest"}
                  </Button>
                  {pendingCount > 0 && (
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={triggerEnrichment} disabled={enriching}>
                      {enriching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Cpu className="h-3 w-3 mr-1" />}Enrich ({pendingCount})
                    </Button>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
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
                {/* Review mode banner */}
                {reviewMode && (
                  <Card className="p-3 bg-primary/5 border-primary/20">
                    <div className="flex items-center gap-2 text-xs">
                      <ClipboardCheck className="h-4 w-4 text-primary" />
                      <div>
                        <span className="font-semibold">Review Queue</span> — Rate each signal to build routing precision.
                        <span className="text-muted-foreground ml-1">{filteredSignals.length} signals to review</span>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Routing Precision Panel */}
                {!reviewMode && categoryFilter === "all" && !searchQuery && (
                  <RoutingPrecisionPanel />
                )}

                {/* Full Feed */}
                <div className="space-y-2">
                  <h2 className="text-xs font-semibold text-muted-foreground">
                    {reviewMode ? "Review Queue" : searchQuery || categoryFilter !== "all" ? "Filtered" : "All"} Signals ({filteredSignals.length})
                  </h2>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : filteredSignals.length === 0 ? (
                    <Card className="p-6 text-center">
                      <Globe className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                      <p className="text-sm text-muted-foreground">
                        {reviewMode ? "No signals need review" : "No signals found"}
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {reviewMode ? "All signals have been reviewed" : "Click \"Ingest\" to pull latest global events"}
                      </p>
                    </Card>
                  ) : (
                    filteredSignals.map(s => (
                      <SignalCard key={s.id} signal={s} audienceMode={audienceMode}
                        onSelect={setSelectedSignal} selected={selectedSignal?.id === s.id}
                        showFeedback={reviewMode} onFeedbackSubmitted={() => setFeedbackCount(c => c + 1)} />
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
