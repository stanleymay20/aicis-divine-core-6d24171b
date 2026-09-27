import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Clock3, Layers3, Radio, Search, ShieldCheck } from "lucide-react";
import {
  GlobalMap,
  type CountryData,
  type IncidentData,
} from "@/components/command-center/GlobalMap";
import {
  RealtimeOperationsStream,
  type RealtimeStreamEvent,
} from "@/components/aicis/RealtimeOperationsStream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";

const countryEntityId = (country: CountryData) =>
  country.iso3 || [country.latitude.toFixed(4), country.longitude.toFixed(4)].join(",");

export default function WorldWorkspace() {
  const navigate = useNavigate();
  const { selectEntity, setCommandPaletteOpen } = useIntelligenceOS();
  const [trayOpen, setTrayOpen] = useState(true);

  const selectCountry = (country: CountryData) => {
    selectEntity({
      id: countryEntityId(country),
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
  };

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
          <Button
            disabled
            variant="ghost"
            size="sm"
            className="hidden h-7 gap-1.5 text-[10px] text-muted-foreground lg:flex"
            title="Layer orchestration is not yet connected to the workspace shell"
          >
            <Layers3 className="h-3.5 w-3.5" /> Layers
          </Button>
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
          className="h-full min-h-[48vh]"
          showSelectionOverlay={false}
          showQuickActions={false}
          showLegend={false}
          showStatusBadge={false}
          compactControls
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
