import { Card, CardContent } from "@/components/ui/card";

export function SummaryTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card className="border-border bg-card/50">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground text-[11px] uppercase tracking-wide">
          {icon} {label}
        </div>
        <div className="text-xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
