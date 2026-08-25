import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

interface PendingOutcome {
  id: string;
  signal_title: string;
  domain: string | null;
  execution_status: string | null;
  outcome_success: boolean | null;
  action_type: string | null;
  created_at: string | null;
}

interface OutcomeFormState {
  outcome_success?: boolean;
  impact_score?: number;
  cost_of_action?: number;
  description?: string;
  source?: "manual" | "internal_report" | "partner_memo" | "external_data" | "api";
}

interface OutcomeResponse {
  evidence_quality_score?: number | null;
  learning_status?: string;
  message?: string;
}

export default function OutcomeInputPanel() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<Record<string, OutcomeFormState>>({});

  const { data: pendingRecords = [] } = useQuery<PendingOutcome[]>({
    queryKey: ["pending-outcome-records"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("decision_outcome_log")
        .select("id, signal_title, domain, execution_status, outcome_success, action_type, created_at")
        .eq("execution_status", "completed")
        .is("outcome_success", null)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as PendingOutcome[];
    },
    staleTime: 30_000,
  });

  const submitOutcome = useMutation<OutcomeResponse, Error, { id: string; payload: Record<string, unknown> }>({
    mutationFn: async ({ id, payload }) => {
      const { data, error } = await supabase.functions.invoke("record-decision-outcome", {
        body: { decision_id: id, ...payload },
      });
      if (error) throw error;
      return (data ?? {}) as OutcomeResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pending-outcome-records"] });
      queryClient.invalidateQueries({ queryKey: ["daily-task-stats"] });
      queryClient.invalidateQueries({ queryKey: ["execution-command-records"] });
      const quality = typeof data.evidence_quality_score === "number"
        ? ` · evidence quality ${(data.evidence_quality_score * 100).toFixed(0)}%`
        : "";
      toast.success(`Outcome reported${quality}`);
    },
    onError: (error) => toast.error(error.message || "Failed to report outcome"),
  });

  const handleSubmit = (id: string) => {
    const state = formState[id] ?? {};
    if (state.outcome_success === undefined) {
      toast.error("Select success or failure");
      return;
    }
    const evidenceNote = state.description?.trim() ?? "";
    if (evidenceNote.length < 30) {
      toast.error("Add at least 30 characters describing the evidence for this outcome");
      return;
    }

    const payload: Record<string, unknown> = {
      outcome_success: state.outcome_success,
      outcome_description: evidenceNote,
      evidence_note: evidenceNote,
      outcome_source: state.source ?? "manual",
      outcome_confidence: "unknown",
    };
    if (state.impact_score !== undefined) payload.impact_score = state.impact_score;
    if (state.cost_of_action !== undefined) payload.cost_of_action = state.cost_of_action;

    submitOutcome.mutate({ id, payload });
    setFormState((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  if (pendingRecords.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-4 text-center">
          <CheckCircle className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">All completed executions have recorded outcomes.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5 text-primary" /> Outcome Capture
          <Badge variant="destructive" className="text-[9px] ml-2">{pendingRecords.length} pending</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendingRecords.map((record) => {
          const state = formState[record.id] ?? {};
          return (
            <div key={record.id} className="border border-destructive/20 rounded p-3 bg-destructive/5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">{record.signal_title || record.action_type?.replace(/_/g, " ")}</p>
                  <div className="flex gap-1.5 mt-0.5">
                    {record.domain && <Badge variant="outline" className="text-[9px] h-4">{record.domain}</Badge>}
                    <Badge variant="destructive" className="text-[9px] h-4">
                      <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Outcome Required
                    </Badge>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">Outcome *</label>
                <div className="flex gap-2">
                  <Button size="sm" variant={state.outcome_success === true ? "default" : "outline"} className="h-7 text-xs flex-1"
                    onClick={() => setFormState((previous) => ({ ...previous, [record.id]: { ...state, outcome_success: true } }))}>
                    <CheckCircle className="h-3 w-3 mr-1" /> Success
                  </Button>
                  <Button size="sm" variant={state.outcome_success === false ? "destructive" : "outline"} className="h-7 text-xs flex-1"
                    onClick={() => setFormState((previous) => ({ ...previous, [record.id]: { ...state, outcome_success: false } }))}>
                    <XCircle className="h-3 w-3 mr-1" /> Failed
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">
                  Impact assessment: {state.impact_score === undefined ? "not provided" : `${state.impact_score}/100`}
                </label>
                <Slider min={0} max={100} step={1} value={[state.impact_score ?? 50]}
                  onValueChange={([value]) => setFormState((previous) => ({ ...previous, [record.id]: { ...state, impact_score: value } }))} />
                <p className="text-[9px] text-muted-foreground mt-1">Optional. Moving the slider records an analyst assessment; it is not treated as a measured value.</p>
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">Observed cost of action</label>
                <Input className="h-7 text-xs" type="number" min="0" placeholder="Leave blank if unknown" value={state.cost_of_action ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFormState((previous) => ({
                      ...previous,
                      [record.id]: { ...state, cost_of_action: value === "" ? undefined : Number(value) },
                    }));
                  }} />
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">Evidence source</label>
                <Select value={state.source ?? "manual"} onValueChange={(value: OutcomeFormState["source"]) => setFormState((previous) => ({ ...previous, [record.id]: { ...state, source: value } }))}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual observation</SelectItem>
                    <SelectItem value="internal_report">Internal report</SelectItem>
                    <SelectItem value="partner_memo">Partner memo</SelectItem>
                    <SelectItem value="external_data">External data</SelectItem>
                    <SelectItem value="api">API / automated evidence</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">Evidence / outcome description *</label>
                <Textarea className="text-xs min-h-[64px]" placeholder="Describe what happened and the evidence supporting this assessment (minimum 30 characters)."
                  value={state.description ?? ""}
                  onChange={(event) => setFormState((previous) => ({ ...previous, [record.id]: { ...state, description: event.target.value } }))} />
                <p className="text-[9px] text-muted-foreground mt-1">Manual reports are quality-scored and weak evidence is excluded from learning.</p>
              </div>

              <Button size="sm" className="h-7 text-xs w-full" onClick={() => handleSubmit(record.id)}
                disabled={submitOutcome.isPending}>
                Report Outcome & Evaluate Evidence
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
