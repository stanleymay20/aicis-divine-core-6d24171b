import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Activity, Check, Clock3, Layers3, Network, Radio, Search, ShieldCheck } from "lucide-react";
import {
  GlobalMap,
  type CountryData,
  type GlobalMapRef,
  type IncidentData,
} from "@/components/command-center/GlobalMap";
import {
  RealtimeOperationsStream,
  type RealtimeStreamEvent,
} from "@/components/aicis/RealtimeOperationsStream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import { ALL_COUNTRIES } from "@/lib/geo/all-countries";

type WorldLayer = "vulnerability" | "networks";

const countryEntityId = (country: CountryData) =>
  country.iso3 || [country.latitude.toFixed(4), country.longitude.toFixed(4)].join(",");

const readLayer = (value: string | null): WorldLayer =>
  value === "networks" ? "networks" : "vulnerability";

export default function WorldWorkspace() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    selectedEntity,
    selectEntity,
    setCommandPaletteOpen,
  } = useIntelligenceOS();
  const mapRef = useRef<GlobalMapRef>(null);
  const lastMapEntityRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [trayOpen, setTrayOpen] = useState(true);
  const activeLayer = readLayer(searchParams.get("layer"));

  const setLayer = useCallback(
    (layer: WorldLayer) => {
      const next = new URLSearchParams(searchParams);
      next.set("layer", layer);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const selectCountry = useCallback(
    (country: CountryData) => {
      const id = countryEntityId(country);
      lastMapEntityRef.current = id.toUpperCase();

      selectEntity({
        id,
        type: "country",
        name: country.country,
        description: country.iso3
          ? `${country.iso3} · mapped country context`
          : "Mapped country context",
        geography: {
          country: country.country,
        },
        metadata: {
          iso3: country.iso3 || null,
          latitude: country.latitude,
          longitude: country.longitude,
          vulnerabilityScore: country.overall_score ?? null,
        },
      });
    },
    [selectEntity],
  );

  const selectIncident = (incident: IncidentData) => {
    selectEntity({
      id: incident.id,
      type: "event",
      name: incident.headline,
      description: `${incident.event_type} · severity ${incident.severity}`,
      observedAt: incident.triggered_at,
      geography: {
        country: incident.country,
      },
      provenance: [
        {
          id: `critical-alert:${incident.id}`,
          label: "Critical alerts",
          sourceType: "operational event",
          observedAt: incident.triggered_at,
        },
      ],
      metadata: {
        severity: incident.severity,
        eventType: incident.event_type,
        latitude: incident.latitude,
        longitude: incident.longitude,
      },
    });
  };

  const selectStreamEvent = (event: RealtimeStreamEvent) => {
    selectEntity({
      id: event.id,
      type: "signal",
      name: event.title,
      description: event.summary,
      observedAt: event.timestamp,
      provenance: [
        {
          id: `stream:${event.id}`,
          label: event.source,
          sourceType: event.domain,
          observedAt: event.timestamp,
        },
      ],
      metadata: {
        domain: event.domain,
        severity: event.severity,
        source: event.source,
      },
    });
  };

  useEffect(() => {
    if (!mapReady || selectedEntity?.type !== "country") return;

    const entityKey = selectedEntity.id.toUpperCase();
    if (lastMapEntityRef.current === entityKey) return;

    const country = ALL_COUNTRIES.find((candidate) => candidate.iso3 === entityKey);
    if (!country) return;

    lastMapEntityRef.current = entityKey;
    mapRef.current?.flyToCountry(country);
  }, [mapReady, selectedEntity?.id, selectedEntity?.type]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-2.5 backdrop-blur-xl sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Badge
            variant="outline"
            className="hidden h-6 border-primary/25 bg-primary/5 text-[9px] uppercase tracking-[0.16em] text-primary md:inline-flex"
          >
            Global situation
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 min-w-0 max-w-[320px] justify-start gap-2 px-2 text-xs text-muted-foreground"
            onClick={() => setCommandPaletteOpen(true)}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Search World or run a command</span>
          </Button>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            disabled
            variant="ghost"
            size="sm"
            className="hidden h-7 gap-1.5 text-[10px] text-muted-foreground lg:flex"
            title="Time-window filtering is not yet connected to a governed data contract"
          >
            <Clock3 className="h-3.5 w-3.5" /> 24h
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="hidden h-7 gap-1.5 text-[10px] text-muted-foreground sm:flex"
                aria-label="Choose World map layer"
              >
                <Layers3 className="h-3.5 w-3.5" />
                {activeLayer === "networks" ? "Networks" : "Vulnerability"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Governed layers
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setLayer("vulnerability")}>
                <ShieldCheck className="mr-2 h-4 w-4" />
                Vulnerability
                {activeLayer === "vulnerability" && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLayer("networks")}>
                <Network className="mr-2 h-4 w-4" />
                Measured networks
                {activeLayer === "networks" && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                Only layers with a connected data contract are enabled here.
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[10px] text-muted-foreground"
            onClick={() => setTrayOpen((open) => !open)}
            aria-pressed={trayOpen}
          >
            <Radio className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{trayOpen ? "Hide feed" : "Live feed"}</span>
          </Button>
        </div>
      </div>

      <section className="relative min-h-[48vh] flex-1 overflow-hidden">
        <GlobalMap
          ref={mapRef}
          className="h-full min-h-[48vh]"
          showSelectionOverlay={false}
          showQuickActions={false}
          showLegend={false}
          showStatusBadge={false}
          compactControls
          activeLayer={activeLayer}
          onActiveLayerChange={(layer) => {
            if (layer === "vulnerability" || layer === "networks") setLayer(layer);
          }}
          onReady={() => setMapReady(true)}
          onCountrySelect={selectCountry}
          onIncidentSelect={selectIncident}
        />

        <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5">
          <Badge
            variant="secondary"
            className="h-6 border border-border/70 bg-background/85 text-[9px] font-mono shadow-sm backdrop-blur-md"
          >
            <Activity className="mr-1 h-3 w-3 text-primary" /> WORLD STATE
          </Badge>
          <Badge
            variant="secondary"
            className="hidden h-6 border border-border/70 bg-background/85 text-[9px] font-mono shadow-sm backdrop-blur-md sm:inline-flex"
          >
            <ShieldCheck className="mr-1 h-3 w-3 text-muted-foreground" /> EVIDENCE-AWARE
          </Badge>
          <Badge
            variant="secondary"
            className="hidden h-6 border border-border/70 bg-background/85 text-[9px] font-mono shadow-sm backdrop-blur-md md:inline-flex"
          >
            <Layers3 className="mr-1 h-3 w-3 text-muted-foreground" />
            {activeLayer.toUpperCase()}
          </Badge>
        </div>

        <div className="pointer-events-none absolute bottom-3 right-3 z-20 hidden max-w-sm rounded-md border border-border/70 bg-background/80 px-2.5 py-1.5 text-[9px] leading-relaxed text-muted-foreground backdrop-blur-md md:block">
          Select a country, incident, or live signal to inspect it without leaving World.
        </div>
      </section>

      {trayOpen && (
        <section className="h-[188px] shrink-0 overflow-hidden border-t border-border/60 bg-background/98 sm:h-[208px]">
          <div className="flex h-8 items-center justify-between border-b border-border/60 px-3">
            <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Live intelligence
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => navigate("/live-stream")}
            >
              Open stream
            </Button>
          </div>
          <div className="h-[156px] overflow-y-auto p-2 sm:h-[176px]">
            <RealtimeOperationsStream compact onEventSelect={selectStreamEvent} />
          </div>
        </section>
      )}
    </div>
  );
}
