import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, BrainCircuit, Clock3, Layers3, Radio, Search, ShieldCheck } from "lucide-react";
import { GlobalMap } from "@/components/command-center/GlobalMap";
import { RealtimeOperationsStream } from "@/components/aicis/RealtimeOperationsStream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SelectedCountry {
  country: string;
  iso3: string;
  latitude: number;
  longitude: number;
  overall_score?: number;
}

const inspectorTabs = ["Summary", "Evidence", "Timeline", "Causal", "Forecasts", "Decisions", "Outcomes"] as const;
type InspectorTab = (typeof inspectorTabs)[number];

export default function WorldWorkspace() {
  const navigate = useNavigate();
  const [selectedCountry, setSelectedCountry] = useState<SelectedCountry | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("Summary");
  const [trayOpen, setTrayOpen] = useState(true);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-2.5 backdrop-blur-xl sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Badge variant="outline" className="hidden h-6 border-primary/25 bg-primary/5 text-[9px] uppercase tracking-[0.16em] text-primary md:inline-flex">
            Global situation
          </Badge>
          <Button variant="ghost" size="sm" className="h-7 min-w-0 max-w-[280px] justify-start gap-2 px-2 text-xs text-muted-foreground" onClick={() => navigate("/intelligence-engine")}>
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Search or ask AICIS</span>
          </Button>
        </div>

        <div className="flex items-center gap-0.5">
          <Button disabled variant="ghost" size="sm" className="hidden h-7 gap-1.5 text-[10px] text-muted-foreground lg:flex" title="Time-window filtering is not yet connected to a governed data contract">
            <Clock3 className="h-3.5 w-3.5" /> 24h
          </Button>
          <Button disabled variant="ghost" size="sm" className="hidden h-7 gap-1.5 text-[10px] text-muted-foreground lg:flex" title="Layer orchestration is not yet connected to the workspace shell">
            <Layers3 className="h-3.5 w-3.5" /> Layers
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[10px] text-muted-foreground" onClick={() => setTrayOpen((open) => !open)} aria-pressed={trayOpen}>
            <Radio className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{trayOpen ? "Hide feed" : "Live feed"}</span>
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="relative min-h-[48vh] overflow-hidden border-b border-border/60 xl:min-h-0 xl:border-b-0 xl:border-r">
          <GlobalMap
            className="h-full min-h-[48vh] xl:min-h-0"
            onCountrySelect={(country) => {
              setSelectedCountry(country);
              setActiveTab("Summary");
            }}
          />

          <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5">
            <Badge variant="secondary" className="h-6 border border-border/70 bg-background/85 text-[9px] font-mono shadow-sm backdrop-blur-md">
              <Activity className="mr-1 h-3 w-3 text-primary" /> WORLD STATE
            </Badge>
            <Badge variant="secondary" className="hidden h-6 border border-border/70 bg-background/85 text-[9px] font-mono shadow-sm backdrop-blur-md sm:inline-flex">
              <ShieldCheck className="mr-1 h-3 w-3 text-muted-foreground" /> EVIDENCE-AWARE
            </Badge>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col bg-background/98 xl:bg-card/30">
          <div className="shrink-0 border-b border-border/60 px-3.5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Context inspector</div>
                <h1 className="mt-1 truncate text-[15px] font-semibold leading-tight">
                  {selectedCountry?.country ?? "Select a country or signal"}
                </h1>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                  {selectedCountry
                    ? `${selectedCountry.iso3 || "No ISO code"} · ${selectedCountry.latitude.toFixed(2)}, ${selectedCountry.longitude.toFixed(2)}`
                    : "Move from geographic observation to evidence, forecast and decision without losing context."}
                </p>
              </div>
              {selectedCountry?.overall_score != null && (
                <Badge variant={selectedCountry.overall_score >= 60 ? "destructive" : "outline"} className="shrink-0 font-mono text-[10px]">
                  {Math.round(selectedCountry.overall_score)}/100
                </Badge>
              )}
            </div>
          </div>

          <div className="shrink-0 overflow-x-auto border-b border-border/60 px-2 py-1.5 scrollbar-hide">
            <div className="flex min-w-max gap-0.5">
              {inspectorTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === tab ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
            {!selectedCountry ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border/60 bg-card/40 p-3">
                  <p className="text-xs font-medium">Start with the map</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Select a mapped country or signal to keep spatial context visible while inspecting deeper intelligence.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
                  <Button variant="outline" size="sm" className="h-8 justify-start text-[11px]" onClick={() => navigate("/morning-brief")}>Executive brief</Button>
                  <Button variant="outline" size="sm" className="h-8 justify-start text-[11px]" onClick={() => navigate("/analyst")}>Analyst workspace</Button>
                  <Button variant="outline" size="sm" className="h-8 justify-start text-[11px]" onClick={() => navigate("/forecast-validation")}>Forecast validation</Button>
                  <Button variant="outline" size="sm" className="h-8 justify-start text-[11px]" onClick={() => navigate("/decision-ops")}>Decision operations</Button>
                </div>
              </div>
            ) : activeTab === "Summary" ? (
              <div className="space-y-4">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Observed spatial context</div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                    <div><dt className="text-[10px] text-muted-foreground">Country</dt><dd className="mt-0.5 font-medium">{selectedCountry.country}</dd></div>
                    <div><dt className="text-[10px] text-muted-foreground">ISO3</dt><dd className="mt-0.5 font-mono">{selectedCountry.iso3 || "—"}</dd></div>
                    <div><dt className="text-[10px] text-muted-foreground">Latitude</dt><dd className="mt-0.5 font-mono">{selectedCountry.latitude.toFixed(3)}</dd></div>
                    <div><dt className="text-[10px] text-muted-foreground">Longitude</dt><dd className="mt-0.5 font-mono">{selectedCountry.longitude.toFixed(3)}</dd></div>
                  </dl>
                </div>
                <div className="border-t border-border/60 pt-3">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Only values already supplied by the mapped source are shown here. Deeper evidence, chronology, causal analysis and forecasts remain abstained until their governed contracts are connected.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border/60 bg-card/35 p-3">
                <div className="flex items-center gap-2 text-xs font-medium"><BrainCircuit className="h-4 w-4 text-primary" /> {activeTab}</div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Contextual {activeTab.toLowerCase()} integration is not yet proven on this branch. AICIS abstains rather than presenting disconnected or fabricated data.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {trayOpen && (
        <section className="h-[170px] shrink-0 overflow-hidden border-t border-border/60 bg-background/98 sm:h-[190px]">
          <div className="flex h-8 items-center justify-between border-b border-border/60 px-3">
            <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" /><span className="relative inline-flex h-2 w-2 rounded-full bg-primary" /></span>
              Live intelligence
            </div>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => navigate("/live-stream")}>Open stream</Button>
          </div>
          <div className="h-[138px] overflow-y-auto p-2 sm:h-[158px]">
            <RealtimeOperationsStream />
          </div>
        </section>
      )}
    </div>
  );
}
