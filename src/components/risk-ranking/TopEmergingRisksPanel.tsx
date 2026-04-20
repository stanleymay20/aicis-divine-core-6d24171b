import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flame, ArrowRight, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Row {
  country_iso3: string;
  domain: string;
  risk_probability: number;
  rank_position: number;
  factors: any;
}

const severityClass = (p: number) =>
  p >= 0.7 ? "bg-destructive/15 text-destructive border-destructive/30" :
  p >= 0.5 ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
             "bg-primary/10 text-primary border-primary/20";

export const TopEmergingRisksPanel = () => {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["top-emerging-risks-home"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("predict-risk-ranking", {
        body: { mode: "leaderboard", top_n: 10 },
      });
      if (error) throw error;
      return data as { rows: Row[]; generated_at: string };
    },
    staleTime: 60_000,
  });

  return (
    <Card className="border-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Flame className="h-4 w-4 text-destructive shrink-0" />
            <h3 className="text-sm font-semibold truncate">Top Emerging Risks · Next 7 Days</h3>
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => navigate("/risk-ranking")}>
            View all <ArrowRight className="h-3 w-3" />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.rows?.length ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No predictions yet. Generating…</p>
        ) : (
          <div className="space-y-1.5">
            {data.rows.slice(0, 10).map((r) => (
              <button
                key={`${r.country_iso3}-${r.domain}`}
                onClick={() => navigate(`/risk-ranking?iso3=${r.country_iso3}&domain=${r.domain}`)}
                className="w-full flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-muted/50 transition text-left"
              >
                <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0">#{r.rank_position}</span>
                <span className="text-xs font-mono font-semibold w-10 shrink-0">{r.country_iso3}</span>
                <span className="text-xs text-muted-foreground capitalize flex-1 truncate">{r.domain}</span>
                <Badge variant="outline" className={`text-[10px] font-mono ${severityClass(Number(r.risk_probability))}`}>
                  {(Number(r.risk_probability) * 100).toFixed(0)}%
                </Badge>
              </button>
            ))}
          </div>
        )}
        {data?.generated_at && (
          <p className="text-[10px] text-muted-foreground text-right">
            Updated {new Date(data.generated_at).toLocaleTimeString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
