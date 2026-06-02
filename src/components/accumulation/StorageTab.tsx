import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { ageHours, freshnessTone, fmt } from "./atoms";
import type { TableTotal } from "./types";

export function StorageTab({ tables, totalRows }: { tables: TableTotal[]; totalRows: number }) {
  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-semibold">What's stored, and where you can use it</h3>
      <div className="space-y-2">
        {tables.map((t) => {
          const pct = totalRows ? (t.rows / totalRows) * 100 : 0;
          const h = ageHours(t.last);
          const f = freshnessTone(h);
          return (
            <div key={t.tbl} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium truncate">{t.label}</span>
                  {t.href && (
                    <Link to={t.href} className="text-primary hover:underline inline-flex items-center gap-0.5 text-[10px]">
                      open <ExternalLink className="h-2.5 w-2.5" />
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("text-[10px]", f.tone)}>{f.label}</span>
                  <span className="font-mono">{fmt(t.rows)}</span>
                </div>
              </div>
              <Progress value={pct} className="h-1.5" />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
