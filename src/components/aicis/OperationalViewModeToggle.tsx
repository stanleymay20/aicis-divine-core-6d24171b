import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Radar, Shield } from "lucide-react";

export type OperationalViewMode = "executive" | "analyst" | "operations";

const modes = [
  {
    key: "executive",
    label: "Executive",
    icon: LayoutDashboard,
    description: "Calm decision-focused operational summaries",
  },
  {
    key: "analyst",
    label: "Analyst",
    icon: Radar,
    description: "Dense telemetry and intelligence visibility",
  },
  {
    key: "operations",
    label: "Operations",
    icon: Shield,
    description: "Realtime coordination and escalation workflows",
  },
] as const;

export function OperationalViewModeToggle({
  value,
  onChange,
}: {
  value: OperationalViewMode;
  onChange: (mode: OperationalViewMode) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-sm font-medium">Operational View Mode</div>
          <div className="text-xs text-muted-foreground mt-1">
            Adaptive intelligence density based on user role.
          </div>
        </div>

        <Badge variant="outline" className="uppercase tracking-wider text-[10px]">
          Adaptive UI
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const active = value === mode.key;

          return (
            <Button
              key={mode.key}
              type="button"
              variant={active ? "default" : "outline"}
              className="justify-start h-auto py-3"
              onClick={() => onChange(mode.key)}
            >
              <div className="flex items-start gap-3 text-left">
                <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{mode.label}</div>
                  <div className="text-[11px] opacity-80 mt-1 leading-relaxed whitespace-normal">
                    {mode.description}
                  </div>
                </div>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
