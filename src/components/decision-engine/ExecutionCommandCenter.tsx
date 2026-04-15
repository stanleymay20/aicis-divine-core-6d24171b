import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PlayCircle, PauseCircle, CheckCircle, XCircle, AlertTriangle,
  Clock, ChevronDown, ChevronUp, User, ClipboardCheck
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { CompleteActionDialog } from "./CompleteActionDialog";

interface ExecRecord {
  id: string;
  signal_title: string;
  domain: string | null;
  execution_status: string | null;
  execution_owner: string | null;
  execution_started_at: string | null;
  execution_completed_at: string | null;
  execution_blocker: string | null;
  recommendation_accepted: boolean | null;
  created_at: string | null;
  review_sla_hours: number | null;
  action_type: string | null;
  outcome_success: boolean | null;
}

export default function ExecutionCommandCenter() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("not_started");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ownerInput, setOwnerInput] = useState<Record<string, string>>({});
  const [blockerInput, setBlockerInput] = useState<Record<string, string>>({});
  const [completeDialogId, setCompleteDialogId] = useState<string | null>(null);
  const [completeDialogTitle, setCompleteDialogTitle] = useState<string>("");

  const { data: records = [] } = useQuery<ExecRecord[]>({
    queryKey: ["execution-command-records"],
    queryFn: async () => {
      const { data } = await supabase
        .from("decision_outcome_log")
        .select("id, signal_title, domain, execution_status, execution_owner, execution_started_at, execution_completed_at, execution_blocker, recommendation_accepted, created_at, review_sla_hours, action_type, outcome_success")
        .eq("recommendation_accepted", true)
        .order("created_at", { ascending: false })
        .limit(100);
      return (data as any) || [];
    },
    staleTime: 30_000,
  });

  const updateExec = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from("decision_outcome_log").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["execution-command-records"] });
      queryClient.invalidateQueries({ queryKey: ["daily-task-stats"] });
      toast.success("Execution status updated");
    },
  });

  const notStarted = records.filter(r => !r.execution_status || r.execution_status === "not_started");
  const inProgress = records.filter(r => r.execution_status === "in_progress");
  const completed = records.filter(r => r.execution_status === "completed");
  const abandoned = records.filter(r => r.execution_status === "abandoned");
  const blocked = records.filter(r => r.execution_blocker);

  const avgLagHours = (() => {
    const started = records.filter(r => r.execution_started_at && r.created_at);
    if (!started.length) return null;
    const totalH = started.reduce((sum, r) => sum + (new Date(r.execution_started_at!).getTime() - new Date(r.created_at!).getTime()) / 3600000, 0);
    return Math.round(totalH / started.length);
  })();

  const getTabRecords = () => {
    switch (tab) {
      case "not_started": return notStarted;
      case "in_progress": return inProgress;
      case "completed": return completed;
      case "abandoned": return abandoned;
      case "blocked": return blocked;
      default: return records;
    }
  };

  const handleStartExecution = (id: string) => {
    const owner = ownerInput[id];
    if (!owner) { toast.error("Execution owner is required"); return; }
    updateExec.mutate({
      id, updates: {
        execution_status: "in_progress",
        execution_started_at: new Date().toISOString(),
        execution_owner: owner,
        action_taken: true,
        action_taken_at: new Date().toISOString(),
      }
    });
  };

  const handleMarkBlocked = (id: string) => {
    const blocker = blockerInput[id];
    if (!blocker) { toast.error("Describe the blocker"); return; }
    updateExec.mutate({ id, updates: { execution_blocker: blocker } });
  };

  const filtered = getTabRecords();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <PlayCircle className="h-3.5 w-3.5 text-primary" /> Execution Command Center
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <KpiBox label="Not Started" value={notStarted.length} warn={notStarted.length > 5} />
          <KpiBox label="In Progress" value={inProgress.length} />
          <KpiBox label="Completed" value={completed.length} />
          <KpiBox label="Abandoned" value={abandoned.length} />
          <KpiBox label="Blocked" value={blocked.length} destructive={blocked.length > 0} />
          <KpiBox label="Avg Lag" value={avgLagHours != null ? `${avgLagHours}h` : "—"} />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full flex-wrap h-auto gap-1">
            <TabsTrigger value="not_started" className="text-xs">Not Started ({notStarted.length})</TabsTrigger>
            <TabsTrigger value="in_progress" className="text-xs">In Progress ({inProgress.length})</TabsTrigger>
            <TabsTrigger value="completed" className="text-xs">Completed ({completed.length})</TabsTrigger>
            <TabsTrigger value="abandoned" className="text-xs">Abandoned ({abandoned.length})</TabsTrigger>
            <TabsTrigger value="blocked" className="text-xs">Blocked ({blocked.length})</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-3 space-y-2">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No records in this category.</p>
            ) : filtered.map(rec => {
              const isOpen = expandedId === rec.id;
              const ageHours = rec.created_at ? Math.round((Date.now() - new Date(rec.created_at).getTime()) / 3600000) : 0;
              const overSLA = rec.review_sla_hours && ageHours > rec.review_sla_hours;

              return (
                <div key={rec.id} className={`border rounded ${overSLA && tab === "not_started" ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
                  <div className="flex items-center gap-2 p-2.5 cursor-pointer hover:bg-muted/30" onClick={() => setExpandedId(isOpen ? null : rec.id)}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{rec.signal_title || rec.action_type?.replace(/_/g, " ")}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {rec.domain && <Badge variant="outline" className="text-[9px] h-4">{rec.domain}</Badge>}
                        {rec.execution_owner && <Badge variant="secondary" className="text-[9px] h-4"><User className="h-2 w-2 mr-0.5" />{rec.execution_owner}</Badge>}
                        {overSLA && <Badge variant="destructive" className="text-[9px] h-4"><AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Over SLA</Badge>}
                        {rec.execution_blocker && <Badge variant="destructive" className="text-[9px] h-4">Blocked</Badge>}
                      </div>
                    </div>
                    {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>

                  {isOpen && (
                    <div className="border-t border-border p-3 space-y-3 bg-muted/10">
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div><span className="text-muted-foreground">Age</span><p className="font-medium">{ageHours}h</p></div>
                        <div><span className="text-muted-foreground">Status</span><p className="font-medium">{rec.execution_status || "not_started"}</p></div>
                        {rec.execution_started_at && <div><span className="text-muted-foreground">Started</span><p className="font-medium">{new Date(rec.execution_started_at).toLocaleString()}</p></div>}
                        {rec.execution_completed_at && <div><span className="text-muted-foreground">Completed</span><p className="font-medium">{new Date(rec.execution_completed_at).toLocaleString()}</p></div>}
                      </div>

                      {(!rec.execution_status || rec.execution_status === "not_started") && (
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground block mb-1">Execution Owner *</label>
                            <Input className="h-7 text-xs" placeholder="Who will execute this?" value={ownerInput[rec.id] || ""} onChange={e => setOwnerInput(p => ({ ...p, [rec.id]: e.target.value }))} />
                          </div>
                          <Button size="sm" className="h-7 text-xs" onClick={() => handleStartExecution(rec.id)}>
                            <PlayCircle className="h-3 w-3 mr-1" />Start
                          </Button>
                        </div>
                      )}

                      {rec.execution_status === "in_progress" && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => { setCompleteDialogId(rec.id); setCompleteDialogTitle(rec.signal_title || ""); }}>
                            <ClipboardCheck className="h-3 w-3 mr-1" />Complete & Record
                          </Button>
                          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => updateExec.mutate({ id: rec.id, updates: { execution_status: "abandoned" } })}>
                            <XCircle className="h-3 w-3 mr-1" />Abandon
                          </Button>
                        </div>
                      )}

                      {!rec.execution_blocker && rec.execution_status !== "completed" && (
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground block mb-1">Mark Blocked</label>
                            <Input className="h-7 text-xs" placeholder="What's blocking?" value={blockerInput[rec.id] || ""} onChange={e => setBlockerInput(p => ({ ...p, [rec.id]: e.target.value }))} />
                          </div>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleMarkBlocked(rec.id)}>
                            <PauseCircle className="h-3 w-3 mr-1" />Block
                          </Button>
                        </div>
                      )}
                      {rec.execution_blocker && (
                        <div className="text-[10px]">
                          <span className="text-muted-foreground font-medium">Blocker: </span>
                          <span className="text-destructive">{rec.execution_blocker}</span>
                          <Button size="sm" variant="ghost" className="h-5 text-[9px] ml-2" onClick={() => updateExec.mutate({ id: rec.id, updates: { execution_blocker: null } })}>Clear</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </CardContent>
      <CompleteActionDialog
        open={!!completeDialogId}
        onOpenChange={(open) => { if (!open) setCompleteDialogId(null); }}
        actionId={completeDialogId}
        actionTitle={completeDialogTitle}
      />
    </Card>
  );
}

function KpiBox({ label, value, warn, destructive }: { label: string; value: number | string; warn?: boolean; destructive?: boolean }) {
  return (
    <div className={`p-2 rounded text-center ${destructive ? "bg-destructive/10 border border-destructive/20" : warn ? "bg-warning/5 border border-warning/20" : "bg-muted/30"}`}>
      <p className={`text-sm font-bold ${destructive ? "text-destructive" : ""}`}>{value}</p>
      <p className="text-[9px] text-muted-foreground">{label}</p>
    </div>
  );
}
