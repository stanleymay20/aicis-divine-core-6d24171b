import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, History, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface BacklogRow {
  lane: string;
  stuck_count: number;
  replayable_count: number;
}

interface ReplayRun {
  id: string;
  lane: string;
  mode: string;
  requeued_count: number;
  status: string;
  notes: string | null;
  started_at: string;
}

const LANE_META: Record<string, { title: string; subtitle: string; replayable: boolean }> = {
  geocode: { title: "Failed geocoding", subtitle: "Signals whose location resolution failed", replayable: true },
  geocode_pending: { title: "Pending geocode queue", subtitle: "Never geocoded — drains automatically", replayable: false },
  translation: { title: "Failed translation", subtitle: "Non-English signals the translator could not process", replayable: true },
  country: { title: "Missing country attribution", subtitle: "Signals with no affected country — blocks geo + routing", replayable: true },
  enrichment: { title: "Failed / stalled enrichment", subtitle: "Errored or stuck >2h in processing", replayable: true },
  ingestion_errors: { title: "Constraint-failed ingest rows", subtitle: "Rejected records captured in the ingestion error log", replayable: false },
};

const LANES = ["geocode", "translation", "country", "enrichment"] as const;

export function PipelineReplayPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: backlog, isLoading } = useQuery({
    queryKey: ["replay-backlog"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("replay_backlog_summary" as any);
      if (error) throw error;
      return (data ?? []) as unknown as BacklogRow[];
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["replay-runs"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_replay_runs" as any)
        .select("*")
        .order("started_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as unknown as ReplayRun[];
    },
  });

  const replay = async (lane: string, limit = 2000) => {
    setBusy(lane);
    try {
      const { data, error } = await supabase.functions.invoke("pipeline-replay", {
        body: { lane, limit, force },
      });
      if (error) throw error;
      const requeued = (data as any)?.requeued ?? {};
      const total = Object.values(requeued).reduce((a: number, b: any) => a + Math.max(Number(b) || 0, 0), 0);
      toast({
        title: "Replay dispatched",
        description: `${total.toLocaleString()} signal(s) requeued through the current pipeline logic.`,
      });
      qc.invalidateQueries({ queryKey: ["replay-backlog"] });
      qc.invalidateQueries({ queryKey: ["replay-runs"] });
    } catch (e: any) {
      toast({ title: "Replay failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const rows = (backlog ?? []).filter((r) => LANE_META[r.lane]);

  return (
    <Card className="p-6 space-y-5 border-primary/20">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold font-orbitron flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            Backfill &amp; Replay Console
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Reprocesses signals that failed or were dropped — failed geocoding, pending queues, missing country
            attribution, and constraint-failed runs — using the current pipeline logic. Replays only reset pipeline
            state; the live processors do the work.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="replay-force" checked={force} onCheckedChange={setForce} />
            <Label htmlFor="replay-force" className="text-xs text-muted-foreground">Deep mode</Label>
          </div>
          <Button size="sm" disabled={busy !== null} onClick={() => replay("all", 2000)}>
            <PlayCircle className="h-4 w-4 mr-1" />
            {busy === "all" ? "Replaying…" : "Replay all lanes"}
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Measuring replay backlog…</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((row) => {
          const meta = LANE_META[row.lane];
          const canReplay = (LANES as readonly string[]).includes(row.lane);
          const stuck = Number(row.stuck_count ?? 0);
          const replayable = Number(row.replayable_count ?? 0);
          return (
            <div
              key={row.lane}
              className={cn(
                "rounded-lg border p-4 flex items-start justify-between gap-3",
                stuck > 0 ? "border-warning/30 bg-warning/5" : "border-success/30 bg-success/5",
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{meta.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{meta.subtitle}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant="outline" className="tabular-nums">{stuck.toLocaleString()} stuck</Badge>
                  {canReplay && (
                    <Badge variant="secondary" className="tabular-nums">
                      {replayable.toLocaleString()} replayable now
                    </Badge>
                  )}
                </div>
              </div>
              {canReplay && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || stuck === 0}
                  onClick={() => replay(row.lane, 2000)}
                >
                  {busy === row.lane ? "…" : "Replay"}
                </Button>
              )}
            </div>
          );
        })}
        {!isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No replay backlog reported. Sign in with an operator account if this looks wrong.
          </p>
        )}
      </div>

      <div>
        <p className="text-xs font-medium flex items-center gap-1.5 mb-2 text-muted-foreground">
          <History className="h-3.5 w-3.5" /> Recent replays
        </p>
        {runs && runs.length > 0 ? (
          <div className="space-y-1.5">
            {runs.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 text-xs border rounded px-3 py-2">
                <span className="font-medium">{LANE_META[r.lane]?.title ?? r.lane}</span>
                <span className="text-muted-foreground truncate flex-1">{r.notes ?? "—"}</span>
                <span className="tabular-nums">{Number(r.requeued_count).toLocaleString()}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    r.status === "completed" ? "text-success" : r.status === "error" ? "text-destructive" : "text-warning",
                  )}
                >
                  {r.status}
                </Badge>
                <span className="text-muted-foreground hidden sm:inline">
                  {new Date(r.started_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No replays recorded yet. Run one above to start rebuilding dropped coverage.
          </p>
        )}
      </div>
    </Card>
  );
}
