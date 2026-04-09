import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const SystemHealthBadge = () => {
  const { data: health } = useQuery({
    queryKey: ["system-health-badge"],
    queryFn: async () => {
      const sixHoursAgo = new Date();
      sixHoursAgo.setHours(sixHoursAgo.getHours() - 6);
      const { data } = await supabase
        .from("automation_logs")
        .select("status")
        .gte("executed_at", sixHoursAgo.toISOString());
      const logs = data || [];
      const errors = logs.filter(l => l.status === "error" || l.status === "timeout").length;
      const total = logs.length;
      if (total === 0) return "idle";
      if (errors / total > 0.3) return "degraded";
      if (errors > 0) return "delayed";
      return "healthy";
    },
    staleTime: 120_000,
  });

  const config = {
    healthy: { icon: CheckCircle2, label: "All Systems Healthy", variant: "outline" as const, className: "text-emerald-400 border-emerald-400/30" },
    delayed: { icon: Clock, label: "Minor Delays", variant: "outline" as const, className: "text-yellow-400 border-yellow-400/30" },
    degraded: { icon: AlertTriangle, label: "Degraded", variant: "destructive" as const, className: "" },
    idle: { icon: Clock, label: "Idle", variant: "outline" as const, className: "text-muted-foreground" },
  };

  const c = config[health || "idle"];
  const Icon = c.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={c.variant} className={`gap-1 text-[10px] cursor-default ${c.className}`}>
          <Icon className="h-3 w-3" />
          {c.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        System health based on last 6 hours of automation logs
      </TooltipContent>
    </Tooltip>
  );
};
