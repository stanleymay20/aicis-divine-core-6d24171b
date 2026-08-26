import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  BarChart3,
  Globe,
  Heart,
  Network,
  Radio,
  Shield,
  Utensils,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickActionsProps {
  onAction: (action: string) => void;
  activeLayer?: string;
}

export const QuickActions = ({ onAction, activeLayer }: QuickActionsProps) => {
  const layers = [
    { id: "vulnerability", icon: Shield, label: "Risk", color: "text-destructive" },
    { id: "health", icon: Heart, label: "Health", color: "text-primary" },
    { id: "food", icon: Utensils, label: "Food", color: "text-warning" },
    { id: "energy", icon: Zap, label: "Energy", color: "text-warning" },
    { id: "incidents", icon: AlertTriangle, label: "Incidents", color: "text-warning" },
    { id: "networks", icon: Network, label: "Networks", color: "text-primary" },
  ];

  const actions = [
    { id: "global-scan", icon: Globe, label: "Global Scan" },
    { id: "crisis-check", icon: Radio, label: "Crisis Check" },
    { id: "analytics", icon: BarChart3, label: "Full Analytics" },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {layers.map((layer) => {
          const Icon = layer.icon;
          const isActive = activeLayer === layer.id;
          return (
            <Button
              key={layer.id}
              variant={isActive ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-8 gap-1.5 text-xs",
                isActive && "bg-primary/20 border-primary",
              )}
              onClick={() => onAction(`layer:${layer.id}`)}
            >
              <Icon className={cn("h-3.5 w-3.5", !isActive && layer.color)} />
              {layer.label}
            </Button>
          );
        })}
      </div>

      <div className="flex gap-1">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.id}
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onAction(action.id)}
            >
              <Icon className="h-3 w-3" />
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
};
