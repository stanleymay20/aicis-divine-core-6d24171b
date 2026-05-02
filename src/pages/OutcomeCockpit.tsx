import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { ActionLifecycleControls } from "@/components/pilot-truth/ActionLifecycleControls";
import { ClipboardCheck, AlertTriangle, Clock, FlaskConical } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Row = {
  action_id: string;
  intervention_title: string;
  country_iso3: string;
  domain: string;
  status: "accepted" | "executed";
  accepted_at: string | null;
  executed_at: string | null;
  outcome_logged_at: string | null;
  estimated_roi_eur: number | null;
  pilot_run_id: string | null;
  review_reason: "pilot_pending" | "executed_overdue" | "accepted_overdue" | "in_window" | "logged";
  days_pending: number;
};

const REASON_META: Record<Row["review_reason"], { label: string; tone: string; icon: any }> = {
  pilot_pending:    { label: "Pilot — outcome pending", tone: "bg-violet-500/15 text-violet-600 border-violet-500/30", icon: FlaskConical },
  executed_overdue: { label: "Executed >7d ago",         tone: "bg-amber-500/15 text-amber-600 border-amber-500/30",   icon: Clock },
  accepted_overdue: { label: "Accepted >7d, no exec",    tone: "bg-rose-500/15 text-rose-600 border-rose-500/30",      icon: AlertTriangle },
  in_window:        { label: "In window",                tone: "bg-muted text-muted-foreground border-border",          icon: Clock },
  logged:           { label: "Logged",                   tone: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: ClipboardCheck },
};

export default function OutcomeCockpit() {
  const { hasRole } = useAuth();
  const isPrivileged = hasRole("admin") || hasRole("operator");

  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["outcome-cockpit-queue"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("v_outcome_cockpit_queue" as any)
        .select("*")
        .order("days_pending", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (reasonFilter !== "all") rows = rows.filter((r) => r.review_reason === reasonFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.intervention_title?.toLowerCase().includes(q) ||
          r.country_iso3?.toLowerCase().includes(q) ||
          r.domain?.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [data, reasonFilter, search]);

  const counts = useMemo(() => {
    const rows = data ?? [];
    return {
      total: rows.length,
      pilot: rows.filter((r) => r.review_reason === "pilot_pending").length,
      execOverdue: rows.filter((r) => r.review_reason === "executed_overdue").length,
      acceptOverdue: rows.filter((r) => r.review_reason === "accepted_overdue").length,
    };
  }, [data]);

  return (
    <div className="container max-w-7xl py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Outcome Capture Cockpit</h1>
        <p className="text-sm text-muted-foreground">
          Real-world review surface for accepted / executed actions awaiting evidence-grade outcome capture.
          Only outcomes with <span className="font-mono">evidence_quality_score ≥ 0.5</span> feed the learning loop.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Awaiting review" value={counts.total} />
        <StatCard label="Pilot pending"   value={counts.pilot}        accent="violet" />
        <StatCard label="Executed >7d"    value={counts.execOverdue}  accent="amber" />
        <StatCard label="Accepted >7d"    value={counts.acceptOverdue} accent="rose" />
      </div>

      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle className="text-base">Review Queue</CardTitle>
            <CardDescription className="text-xs">
              No fake execution. No fake outcome. Unknown / inconclusive is allowed.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search title / country / domain"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-56"
            />
            <Select value={reasonFilter} onValueChange={setReasonFilter}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reasons</SelectItem>
                <SelectItem value="pilot_pending">Pilot pending</SelectItem>
                <SelectItem value="executed_overdue">Executed &gt;7d</SelectItem>
                <SelectItem value="accepted_overdue">Accepted &gt;7d</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="text-sm text-destructive">Failed to load cockpit queue: {(error as Error).message}</p>
          )}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <ClipboardCheck className="h-6 w-6 mx-auto mb-2 opacity-60" />
              No actions currently awaiting outcome review.
              <div className="text-[11px] mt-1 opacity-70">
                Either every accepted/executed action is fresh or all outcomes have been logged with evidence.
              </div>
            </div>
          ) : (
            <ScrollArea className="h-[640px] pr-2">
              <ul className="space-y-2">
                {filtered.map((r) => {
                  const meta = REASON_META[r.review_reason];
                  const Icon = meta.icon;
                  return (
                    <li
                      key={r.action_id}
                      className="rounded-md border border-border bg-card/40 p-3 hover:border-border/80 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <Badge variant="outline" className="font-mono text-[10px]">{r.country_iso3}</Badge>
                            <Badge variant="secondary" className="text-[10px]">{r.domain}</Badge>
                            <Badge variant="outline" className={`text-[10px] gap-1 ${meta.tone}`}>
                              <Icon className="h-3 w-3" /> {meta.label}
                            </Badge>
                            {r.pilot_run_id && (
                              <Badge variant="outline" className="text-[10px] font-mono">
                                pilot {r.pilot_run_id.slice(0, 8)}
                              </Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {r.days_pending}d pending
                            </span>
                          </div>
                          <div className="text-sm font-medium truncate">{r.intervention_title}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                            {r.accepted_at && (
                              <span>Accepted {formatDistanceToNow(new Date(r.accepted_at), { addSuffix: true })}</span>
                            )}
                            {r.executed_at && (
                              <span>Executed {formatDistanceToNow(new Date(r.executed_at), { addSuffix: true })}</span>
                            )}
                            {r.estimated_roi_eur != null && (
                              <span>Est. ROI €{Math.round(r.estimated_roi_eur).toLocaleString()}</span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <ActionLifecycleControls
                            actionId={r.action_id}
                            status={r.status}
                            interventionTitle={r.intervention_title}
                            estimatedRoiEur={r.estimated_roi_eur}
                            iso3={r.country_iso3}
                            domain={r.domain}
                            isPrivileged={isPrivileged}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: "violet" | "amber" | "rose" }) {
  const tone =
    accent === "violet" ? "text-violet-600"
    : accent === "amber" ? "text-amber-600"
    : accent === "rose" ? "text-rose-600"
    : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
