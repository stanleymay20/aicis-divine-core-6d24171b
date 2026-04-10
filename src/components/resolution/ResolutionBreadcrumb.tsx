import { ChevronRight, Globe, Map, MapPin, Layers } from "lucide-react";
import type { DrillState } from "@/pages/ResolutionExplorer";

interface Props {
  drill: DrillState;
  onGlobal: () => void;
  onCountry: (iso3: string, name: string) => void;
}

export const ResolutionBreadcrumb = ({ drill, onGlobal, onCountry }: Props) => {
  const levels = [
    { label: "Global", icon: Globe, active: drill.level === "global", onClick: onGlobal },
    ...(drill.countryName
      ? [{ label: drill.countryName, icon: Map, active: drill.level === "country", onClick: () => onCountry(drill.countryIso3!, drill.countryName!) }]
      : []),
    ...(drill.regionName
      ? [{ label: drill.regionName, icon: MapPin, active: drill.level === "region" || drill.level === "village", onClick: () => {} }]
      : []),
  ];

  return (
    <div className="flex items-center gap-1 text-sm flex-wrap">
      <Layers className="h-4 w-4 text-primary mr-1" />
      {levels.map((l, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <button
            onClick={l.onClick}
            className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
              l.active
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <l.icon className="h-3.5 w-3.5" />
            {l.label}
          </button>
        </span>
      ))}
    </div>
  );
};
