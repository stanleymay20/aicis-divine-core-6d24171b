import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, ArrowRight, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const RecentWinWidget = () => {
  const navigate = useNavigate();

  const { data: win } = useQuery({
    queryKey: ["recent-win"],
    queryFn: async () => {
      const { data } = await supabase
        .from("decision_outcome_log")
        .select("id, signal_title, domain, net_value, roi_estimate, evidence_type, outcome_success, recommended_action, created_at")
        .eq("outcome_success", true)
        .not("net_value", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] || null;
    },
    staleTime: 300_000,
  });

  if (!win) return null;

  const formatCurrency = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  };

  return (
    <Card
      className="border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 to-transparent cursor-pointer hover:border-emerald-500/30 transition-colors"
      onClick={() => navigate("/decision-ops")}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <Trophy className="h-4.5 w-4.5 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400">Recent Win</span>
              <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">
                {win.evidence_type}
              </Badge>
            </div>
            <p className="text-sm font-medium leading-snug line-clamp-2 mb-1.5">
              {win.signal_title?.replace("[SIGNAL] ", "")}
            </p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {win.recommended_action && (
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3 text-primary" />
                  <span className="line-clamp-1">{win.recommended_action}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2">
              {win.net_value && (
                <span className="text-lg font-semibold text-emerald-400">
                  {formatCurrency(Number(win.net_value))}
                </span>
              )}
              {win.roi_estimate && (
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                  {Number(win.roi_estimate).toFixed(1)}x ROI
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground capitalize">{win.domain}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
