import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Layers, BarChart3, TrendingUp } from "lucide-react";
import type { DomainRow, HorizonRow, ModelRow } from "./atoms";

export function BreakdownTables({ domains, horizons, models, snapshots }: {
  domains: DomainRow[]; horizons: HorizonRow[]; models: ModelRow[]; snapshots: any[];
}) {
  return (
    <>
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><Layers className="h-4 w-4" /> By Domain</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Domain</TableHead><TableHead className="text-right">n</TableHead><TableHead className="text-right">TP Acc</TableHead><TableHead className="text-right">MAE</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {domains.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs">No realized data yet</TableCell></TableRow>
                  : domains.map((d) => (
                    <TableRow key={d.domain}>
                      <TableCell className="font-medium text-xs">{d.domain}</TableCell>
                      <TableCell className="text-right text-xs">{d.sample_size}</TableCell>
                      <TableCell className="text-right text-xs">{d.tp_accuracy}%</TableCell>
                      <TableCell className="text-right text-xs">{d.mae}</TableCell>
                      <TableCell className="text-right"><Badge variant={d.status === "good" ? "default" : d.status === "moderate" ? "secondary" : "destructive"} className="text-[10px]">{d.status}</Badge></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><BarChart3 className="h-4 w-4" /> By Horizon</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Horizon</TableHead><TableHead className="text-right">n</TableHead><TableHead className="text-right">Accuracy</TableHead><TableHead className="text-right">MAE</TableHead></TableRow></TableHeader>
              <TableBody>
                {horizons.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-xs">No realized data yet</TableCell></TableRow>
                  : horizons.map((h) => (
                    <TableRow key={h.horizon}><TableCell className="font-medium text-xs">{h.horizon}</TableCell><TableCell className="text-right text-xs">{h.sample_size}</TableCell><TableCell className="text-right text-xs">{h.accuracy}%</TableCell><TableCell className="text-right text-xs">{h.mae}</TableCell></TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">By Model Version</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Model</TableHead><TableHead className="text-right">n</TableHead><TableHead className="text-right">TP Accuracy</TableHead><TableHead className="text-right">MAE</TableHead></TableRow></TableHeader>
            <TableBody>
              {models.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-xs">No realized data yet</TableCell></TableRow>
                : models.map((m) => (
                  <TableRow key={m.model_version}><TableCell className="font-mono text-xs">{m.model_version}</TableCell><TableCell className="text-right text-xs">{m.sample_size}</TableCell><TableCell className="text-right text-xs">{m.tp_accuracy}%</TableCell><TableCell className="text-right text-xs">{m.mae}</TableCell></TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {snapshots.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Health History</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Date</TableHead><TableHead className="text-right text-xs">Total</TableHead><TableHead className="text-right text-xs">Realized</TableHead>
                <TableHead className="text-right text-xs">TP Acc</TableHead><TableHead className="text-right text-xs">MAE</TableHead>
                <TableHead className="text-right text-xs">Domains</TableHead><TableHead className="text-right text-xs">Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {snapshots.slice(0, 10).map((s: any) => (
                  <TableRow key={s.snapshot_date}>
                    <TableCell className="text-xs font-mono">{s.snapshot_date}</TableCell>
                    <TableCell className="text-right text-xs">{s.total_forecasts}</TableCell>
                    <TableCell className="text-right text-xs">{s.realized_count}</TableCell>
                    <TableCell className="text-right text-xs">{s.tp_accuracy != null ? `${s.tp_accuracy}%` : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{s.avg_mae ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs">{s.domains_covered}</TableCell>
                    <TableCell className="text-right"><Badge variant="outline" className="text-[10px]">{s.accumulation_status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
