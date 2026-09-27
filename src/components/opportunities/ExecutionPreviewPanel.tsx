import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, CircleDollarSign, Loader2, ShieldAlert } from "lucide-react";
import { IbkrWhatIfPreviewPanel } from "@/components/opportunities/IbkrWhatIfPreviewPanel";

type Candidate = {
  candidate_id: string;
  title: string;
  transaction_type: string;
  execution_ready: boolean;
  currency?: string | null;
  capital_required?: number | null;
};

type PreviewResponse = {
  ok: boolean;
  code?: string;
  error?: string;
  reasons?: string[];
  preview?: {
    preview_status: "rejected" | "indicative_only" | "unattested_quote" | "previewed_order";
    candidate: {
      candidate_id: string | null;
      candidate_execution_ready: boolean;
      candidate_currency: string | null;
      capital_required: number | null;
    };
    quote: {
      quote_id: string | null;
      provider_quote_id: string | null;
      provider_name: string | null;
      provider_adapter: string | null;
      status: string | null;
      side: string | null;
      pricing_currency: string | null;
      selected_price: number | null;
      selected_price_source: string | null;
      valid_until: string | null;
      estimated_costs_total: number | null;
    };
    economics: {
      gross_notional: number | null;
      estimated_costs_total: number | null;
      estimated_cash_required: number | null;
      estimated_cash_proceeds: number | null;
      estimated_output_amount: number | null;
    };
    normalized_fx_rate?: Record<string, unknown> | null;
    fx_handoff_blocked_reason?: string | null;
    provider_attestation?: {
      required_for_execution_evidence: boolean;
      attested: boolean;
      quote_claims_executable: boolean;
    };
    approval: {
      human_approval_required: true;
      human_approval_package_ready: boolean;
      rebuild_required_before_approval: boolean;
      approved: false;
      approval_token: null;
    };
    execution_boundary: {
      provider_submission_enabled: false;
      order_submitted: false;
      contract_signed: false;
      money_moved: false;
      external_execution_performed: false;
    };
  };
  audit?: {
    quote?: { hash?: string };
    preview?: { hash?: string };
  };
  approval_request?: {
    approval_request_id: string;
    approval_status: "not_approved";
    ready_for_human_review: boolean;
    rebuild_required_before_approval: boolean;
    quote_valid_until: string;
    preview_hash: string;
    quote_hash: string;
    approval_token: null;
    executable_action_available: false;
  } | null;
};

type Props = {
  candidate: Candidate | null;
  strategicAuditHash: string | null;
  onAddExecutableFx: (rate: Record<string, unknown>, candidateId: string) => void;
};

function formatAmount(value: number | null | undefined, currency?: string | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (currency && currency.length === 3) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return value.toLocaleString();
    }
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fxTemplate(candidateId: string) {
  const now = new Date();
  const valid = new Date(now.getTime() + 3 * 60_000);
  return JSON.stringify({
    quote_id: "provider-quote-id",
    provider_quote_id: "provider-native-quote-id",
    provider_name: "Provider name",
    provider_adapter: "provider-adapter-v1",
    status: "executable_quote",
    observed_at: now.toISOString(),
    valid_until: valid.toISOString(),
    instrument: {
      kind: "fx",
      base_currency: "USD",
      quote_currency: "EUR",
      symbol: "USD/EUR",
    },
    execution_context: {
      candidate_id: candidateId,
      purpose: "fx_conversion",
    },
    side: "convert",
    quantity: 1000,
    quantity_unit: "USD",
    pricing: {
      rate: 0,
      currency: "EUR",
    },
    costs: [],
    account_context: {
      provider_account_ref: "masked-reference-only",
    },
    evidence_refs: [],
  }, null, 2);
}

function marketTemplate(candidateId: string) {
  const now = new Date();
  const valid = new Date(now.getTime() + 60_000);
  return JSON.stringify({
    quote_id: "provider-quote-id",
    provider_quote_id: "provider-native-quote-id",
    provider_name: "Provider name",
    provider_adapter: "provider-adapter-v1",
    status: "executable_quote",
    observed_at: now.toISOString(),
    valid_until: valid.toISOString(),
    instrument: {
      kind: "security",
      symbol: "SYMBOL",
    },
    execution_context: {
      candidate_id: candidateId,
      purpose: "primary_transaction",
    },
    side: "buy",
    quantity: 1,
    quantity_unit: "units",
    pricing: {
      bid: 0,
      ask: 0,
      currency: "EUR",
    },
    costs: [
      { type: "commission", amount: 0, currency: "EUR" },
      { type: "slippage_estimate", amount: 0, currency: "EUR" },
    ],
    account_context: {
      provider_account_ref: "masked-reference-only",
    },
    evidence_refs: [],
  }, null, 2);
}

export function ExecutionPreviewPanel({
  candidate,
  strategicAuditHash,
  onAddExecutableFx,
}: Props) {
  const [quoteJson, setQuoteJson] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<PreviewResponse | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => "preview:" + crypto.randomUUID());
  const { toast } = useToast();

  useEffect(() => {
    setResponse(null);
    setIdempotencyKey("preview:" + crypto.randomUUID());
  }, [candidate?.candidate_id, strategicAuditHash]);

  const preview = response?.preview;
  const quoteCurrency = preview?.quote?.pricing_currency ?? candidate?.currency ?? null;

  const ready = Boolean(candidate?.candidate_id && strategicAuditHash && quoteJson.trim());

  const statusLabel = useMemo(() => {
    if (!response) return "not previewed";
    if (!response.ok || !preview) return "rejected";
    if (preview.preview_status === "previewed_order") return "provider-attested preview";
    if (preview.preview_status === "unattested_quote") return "unattested quote";
    return "indicative only";
  }, [response, preview]);

  const runPreview = async () => {
    if (!candidate || !strategicAuditHash) return;

    let quote: unknown;
    try {
      quote = JSON.parse(quoteJson);
    } catch {
      toast({
        title: "Invalid quote JSON",
        description: "The provider-normalized quote must be valid JSON.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("preview-execution", {
      body: {
        candidate: {
          candidate_id: candidate.candidate_id,
          title: candidate.title,
          transaction_type: candidate.transaction_type,
          execution_ready: candidate.execution_ready,
          currency: candidate.currency ?? null,
          capital_required: candidate.capital_required ?? null,
        },
        quote,
        strategic_audit_hash: strategicAuditHash,
        idempotency_key: idempotencyKey,
        as_of: new Date().toISOString(),
      },
    });
    setLoading(false);

    if (error) {
      toast({
        title: "Execution preview failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const next = data as PreviewResponse;
    setResponse(next);
    if (!next.ok) {
      toast({
        title: "Quote rejected",
        description: next.reasons?.join(", ") || next.error || "The quote did not clear the execution-preview contract.",
        variant: "destructive",
      });
    }
  };

  const addFx = () => {
    if (!candidate || !preview?.normalized_fx_rate) return;
    onAddExecutableFx(preview.normalized_fx_rate, candidate.candidate_id);
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <CircleDollarSign className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Execution Preview</p>
          </div>
          <p className="mt-1 max-w-2xl text-[10px] text-muted-foreground">
            Validate a provider-normalized quote, estimate notional and costs, and prepare an auditable human-review package.
            This surface cannot submit orders, sign contracts, or move money.
          </p>
        </div>
        <Badge variant={response?.ok ? "outline" : response ? "destructive" : "secondary"}>
          {statusLabel}
        </Badge>
      </div>

      {!candidate || !strategicAuditHash ? (
        <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
          Build and rank a transaction first. Execution preview requires both a candidate and its pre-outcome strategic audit hash.
        </div>
      ) : (
        <>
          <div className="rounded-md bg-muted/20 p-3 text-[11px]">
            <p><span className="text-muted-foreground">Candidate:</span> {candidate.title}</p>
            <p className="mt-0.5 text-muted-foreground">
              {candidate.candidate_id} · {candidate.execution_ready ? "candidate inputs execution-ready" : "candidate requires rebuild or more evidence"}
            </p>
          </div>

          <Textarea
            value={quoteJson}
            onChange={(event) => {
              setQuoteJson(event.target.value);
              setResponse(null);
            }}
            className="min-h-[260px] font-mono text-xs"
            placeholder="Paste a provider-normalized executable or indicative quote. Credentials, API keys, access tokens, passwords and secrets are forbidden."
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setQuoteJson(fxTemplate(candidate.candidate_id));
                  setResponse(null);
                }}
              >
                FX template
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setQuoteJson(marketTemplate(candidate.candidate_id));
                  setResponse(null);
                }}
              >
                Market quote template
              </Button>
            </div>

            <Button type="button" size="sm" onClick={runPreview} disabled={!ready || loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Preview only
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Idempotency: <code>{idempotencyKey}</code>. Pasted JSON is never treated as provider-attested. Quote payloads may contain masked account references but never provider credentials or secrets.
          </p>

          {response && !response.ok ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <ShieldAlert className="h-4 w-4" />
                Preview rejected
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {(response.reasons || []).join(" · ") || response.error || "No preview was created."}
              </p>
            </div>
          ) : null}

          <IbkrWhatIfPreviewPanel
            candidateId={candidate.candidate_id}
            strategicAuditHash={strategicAuditHash}
          />

          {response?.ok && preview ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <PreviewMetric
                  label="Selected price"
                  value={formatAmount(preview.quote.selected_price, quoteCurrency)}
                />
                <PreviewMetric
                  label="Gross notional"
                  value={formatAmount(preview.economics.gross_notional, quoteCurrency)}
                />
                <PreviewMetric
                  label="Estimated costs"
                  value={formatAmount(preview.economics.estimated_costs_total, quoteCurrency)}
                />
                <PreviewMetric
                  label="Cash required"
                  value={formatAmount(preview.economics.estimated_cash_required, quoteCurrency)}
                />
              </div>

              <div className="rounded-md border border-border/70 p-3 text-[11px]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{preview.quote.provider_name || "Provider"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      quote {preview.quote.provider_quote_id || preview.quote.quote_id || "—"}
                      {preview.quote.valid_until ? " · expires " + new Date(preview.quote.valid_until).toLocaleString() : ""}
                    </p>
                  </div>
                  <Badge variant="outline">{preview.quote.status || "unknown status"}</Badge>
                </div>
              </div>

              <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  {preview.approval.human_approval_package_ready
                    ? <CheckCircle2 className="h-4 w-4 text-primary" />
                    : <ShieldAlert className="h-4 w-4 text-muted-foreground" />}
                  Human-review package
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {preview.approval.human_approval_package_ready
                    ? "The candidate and provider-attested executable quote are complete enough for human review. Nothing has been approved or submitted."
                    : preview.preview_status === "unattested_quote"
                      ? "The supplied quote claims to be executable, but no server-side provider adapter has authenticated it. It remains research-only."
                      : preview.approval.rebuild_required_before_approval
                        ? "The provider-attested quote is executable, but the candidate must be rebuilt with the new evidence before human review can become ready."
                        : "This quote is not execution-ready and cannot create an approval-ready package."}
                </p>
                {response.approval_request ? (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Request {response.approval_request.approval_request_id} · status {response.approval_request.approval_status}
                  </p>
                ) : null}
              </div>

              {preview.normalized_fx_rate ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 p-3">
                  <div>
                    <p className="text-xs font-medium">Executable FX evidence available</p>
                    <p className="text-[10px] text-muted-foreground">
                      Add the normalized executable rate to the transaction bundle, then rebuild all economics and strategy gates.
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={addFx}>
                    Add FX evidence & rebuild
                  </Button>
                </div>
              ) : preview.fx_handoff_blocked_reason ? (
                <div className="rounded-md border border-dashed p-3 text-[10px] text-muted-foreground">
                  FX handoff blocked: explicit provider FX costs are present. AICIS will not inject a bare rate that would omit those costs.
                </div>
              ) : null}

              <div className="rounded-md border border-border/70 p-3 text-[10px] text-muted-foreground">
                <p>
                  Quote fingerprint: <code>{response.audit?.quote?.hash?.slice(0, 16) || "—"}…</code>
                </p>
                <p className="mt-1">
                  Preview fingerprint: <code>{response.audit?.preview?.hash?.slice(0, 16) || "—"}…</code>
                </p>
              </div>

              <div className="rounded-md border border-dashed p-3 text-[10px] text-muted-foreground">
                Provider submission disabled · order not submitted · contract not signed · money not moved · approval token absent.
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 p-2.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs font-semibold">{value}</p>
    </div>
  );
}
