import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio } from "lucide-react";
import { MiniStat, accumStatusColor } from "./atoms";

export function AccumulationMonitor({ accumulation }: { accumulation: any }) {
  if (!accumulation) return null;
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Radio className="h-4 w-4" /> Live Accumulation
          <Badge variant="outline" className={`ml-auto text-[10px] ${accumStatusColor[accumulation.accumulation_status] ?? ""}`}>{accumulation.accumulation_status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
          <MiniStat label="New (24h)" value={accumulation.new_24h} />
          <MiniStat label="New (7d)" value={accumulation.new_7d} />
          <MiniStat label="Realized (24h)" value={accumulation.realized_24h} />
          <MiniStat label="Realized (7d)" value={accumulation.realized_7d} />
          <MiniStat label="Locked" value={accumulation.locked} />
          <MiniStat label="Unlocked" value={accumulation.unlocked} />
          <MiniStat label="Overdue" value={accumulation.overdue} warn={accumulation.overdue > 0} />
          <MiniStat label="Missing actual" value={accumulation.missing_actual} warn={accumulation.missing_actual > 0} />
          <MiniStat label="Duplicates" value={accumulation.duplicates} warn={accumulation.duplicates > 0} />
          <MiniStat label="Domains" value={accumulation.domains} />
          <MiniStat label="Countries" value={accumulation.countries} />
          <MiniStat label="Models" value={accumulation.models} />
        </div>
      </CardContent>
    </Card>
  );
}
