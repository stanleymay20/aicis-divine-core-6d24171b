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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 bg-background/95 px-3 backdrop-blur-xl">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Badge variant="outline" className="hidden h-6 border-primary/25 bg-primary/5 text-[9px] uppercase tracking-[0.16em] text-primary sm:inline-flex">
            Global situation
          </Badge>
          <Button variant="ghost" size="sm" className="h-8 max-w-[260px] justify-start gap-2 text-xs text-muted-foreground" onClick={() => navigate("/intelligence-engine")}>
            <Search className="h-3.5 w-3.5" />
            <span className="truncate">Search or ask AICIS</span>
          </Button>
        </div>

        <div className="hidden items-center gap-1 lg:flex">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[11px] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" /> 24h
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[11px] text-muted-foreground">
            <Layers3 className="h-3.5 w-3.5" /> Layers
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[11px] text-muted-foreground" onClick={() => setTrayOpen((open) => !open)}>
            <Radio className="h-3.5 w-3.5" /> {trayOpen ? "Hide feed" : "Live feed"}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="relative min-h-[520px] overflow-hidden border-b border-border/70 xl:min-h-0 xl:border-b-0 xl:border-r">
          <GlobalMap
            className="h-full min-h-[520px]"
            onCountrySelect={(country) => {
              setSelectedCountry(country);
              setActiveTab("Summary");
            }}
          />

          <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2">
            <Badge variant="secondary" className="pointer-events-auto h-6 border border-border/70 bg-background/85 text-[9px] font-mono backdrop-blur">
              <Activity className="mr-1 h-3 w-3 text-primary" /> WORLD STATE
            </Badge>
            <Badge variant="secondary" className="pointer-events-auto h-6 border border-border/70 bg-background/85 text-[9px] font-mono backdrop-blur">
              <ShieldCheck className="mr-1 h-3 w-3 text-muted-foreground" /> EVIDENCE-AWARE
            </Badge>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col bg-card/35">
          <div className="shrink-0 border-b border-border/70 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Context inspector</div>
                <h1 className="mt-1 truncate text-base font-semibold">
                  {selectedCountry?.country ?? "Select a country or signal"}
                </h1>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {selectedCountry
                    ? `${selectedCountry.iso3 || "No ISO code"} · ${selectedCountry.latitude.toFixed(2)}, ${selectedCountry.longitude.toFixed(2)}`
                    : "Keep geographic context while moving from observation to evidence, forecast and decision."}
                </p>
              </div>
              {selectedCountry?.overall_score != null && (
                <Badge variant={selectedCountry.overall_score >= 60 ? "destructive" : "outline"} className="shrink-0 font-mono">
                  {Math.round(selectedCountry.overall_score)}/100
                </Badge>
              )}
            </div>
          </div>

          <div className="shrink-0 overflow-x-auto border-b border-border/70 px-2 py-2 scrollbar-hide">
            <div className="flex min-w-max gap-1">
              {inspectorTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-colors ${activeTab === tab ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!selectedCountry ? (
              <div className="space-y-4">
                <div className="border-l-2 border-primary/40 pl-3">
                  <p className="text-sm font-medium">Map-first intelligence</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    This branch-only workspace keeps the spatial surface visible while deeper intelligence is inspected. It does not fabricate an assessment when no object is selected.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Button variant="outline" size="sm" className="justify-start" onClick={() => navigate("/morning-brief")}>Executive brief</Button>
                  <Button variant="outline" size="sm" className="justify-start" onClick={() => navigate("/analyst")}>Analyst workspace</Button>
                  <Button variant="outline" size="sm" className="justify-start" onClick={() => navigate("/forecast-validation")}>Forecast validation</Button>
                  <Button variant="outline" size="sm" className="justify-start" onClick={() => navigate("/decision-ops")}>Decision operations</Button>
                </div>
              </div>
            ) : activeTab === "Summary" ? (
              <div className="space-y-4">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Observed spatial context</div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-muted-foreground">Country</dt><dd className="mt-1 font-medium">{selectedCountry.country}</dd></div>
                    <div><dt className="text-muted-foreground">ISO3</dt><dd className="mt-1 font-mono">{selectedCountry.iso3 || "—"}</dd></div>
                    <div><dt className="text-muted-foreground">Latitude</dt><dd className="mt-1 font-mono">{selectedCountry.latitude.toFixed(3)}</dd></div>
                    <div><dt className="text-muted-foreground">Longitude</dt><dd className="mt-1 font-mono">{selectedCountry.longitude.toFixed(3)}</dd></div>
                  </dl>
                </div>
                <div className="border-t border-border/70 pt-4">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    This first reconstruction tranche intentionally exposes only values already provided by the existing map. Evidence, chronology, causal analysis and forecasts stay behind their governed source surfaces until the inspector is wired to those contracts.
                  </p>
                </div>
              </div>
            ) : (
              <div className="border-l-2 border-border pl-3">
                <div className="flex items-center gap-2 text-sm font-medium"><BrainCircuit className="h-4 w-4 text-primary" /> {activeTab}</div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Contextual {activeTab.toLowerCase()} integration is not yet proven on this branch. The workspace abstains instead of presenting disconnected or fabricated data.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {trayOpen && (
        <section className="h-[220px] shrink-0 overflow-hidden border-t border-border/70 bg-background/95">
          <div className="flex h-9 items-center justify-between border-b border-border/60 px-3">
            <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Radio className="h-3.5 w-3.5 text-primary" /> Live intelligence
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => navigate("/live-stream")}>Open full stream</Button>
          </div>
          <div className="h-[181px] overflow-y-auto p-2">
            <RealtimeOperationsStream />
          </div>
        </section>
      )}
    </div>
  );
}
