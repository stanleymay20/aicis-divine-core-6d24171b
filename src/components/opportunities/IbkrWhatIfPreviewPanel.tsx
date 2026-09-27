import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";

type Props = {
  candidateId: string;
  strategicAuditHash: string;
};

type ProviderStatusResponse = {
  ok: boolean;
  providers?: Array<{
    id: string;
    name: string;
    configured: boolean;
    capabilities: {
      market_snapshot: boolean;
      order_preview_whatif: boolean;
      provider_attested_executable_quote: boolean;
      order_submission: boolean;
      money_movement: boolean;
    };
    configuration_boundary: string;
  }>;
};

type IbkrPreviewResponse = {
  ok: boolean;
  code?: string;
  error?: string;
  preview?: {
    preview_status: string;
    provider: {
      name: string;
      capability: string;
      server_attested: boolean;
      account_ref: string;
    };
    order: {
      conid: number | null;
      side: string | null;
      quantity: number | null;
      limit_price: number | null;
    };
    market_snapshot: {
      bid: number | null;
      ask: number | null;
      last: number | null;
      observed_at: string | null;
      market_data_availability: string | null;
    };
    provider_preview: {
      order_amount: number | null;
      commission: number | null;
      total: number | null;
      currency: string | null;
      initial_margin: { change: number | null };
      maintenance_margin: { change: number | null };
      warning: string | null;
      error: string | null;
      observed_at: string | null;
    };
    approval: {
      approval_status: "not_approved";
      approval_token: null;
      executable_action_available: false;
    };
    execution_boundary: {
      order_endpoint_called: false;
      whatif_endpoint_called: boolean;
      order_submitted: false;
      money_moved: false;
      external_execution_performed: false;
    };
  };
};

function num(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function format(value: number | null | undefined, currency?: string | null) {
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

export function IbkrWhatIfPreviewPanel({ candidateId, strategicAuditHash }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [conid, setConid] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [result, setResult] = useState<IbkrPreviewResponse | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => "ibkr-preview:" + crypto.randomUUID());
  const { toast } = useToast();

  const loadStatus = async () => {
    setStatusLoading(true);
    const { data, error } = await supabase.functions.invoke("execution-provider-status", { body: {} });
    setStatusLoading(false);

    if (error) {
      setConfigured(null);
      return;
    }

    const response = data as ProviderStatusResponse;
    const ibkr = response.providers?.find((provider) => provider.id === "interactive_brokers");
    setConfigured(ibkr?.configured === true);
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    setResult(null);
    setIdempotencyKey("ibkr-preview:" + crypto.randomUUID());
  }, [candidateId, strategicAuditHash]);

  const runPreview = async () => {
    const parsedConid = num(conid);
    const parsedQuantity = num(quantity);
    const parsedLimit = num(limitPrice);

    if (
      parsedConid == null ||
      parsedConid <= 0 ||
      parsedQuantity == null ||
      parsedQuantity <= 0 ||
      parsedLimit == null ||
      parsedLimit <= 0
    ) {
      toast({
        title: "Incomplete IBKR preview",
        description: "Positive conid, quantity and limit price are required.",
        variant: "destructive",
      });
      return;
    }

    setPreviewLoading(true);
    const { data, error } = await supabase.functions.invoke("preview-execution-ibkr", {
      body: {
        candidate_id: candidateId,
        strategic_audit_hash: strategicAuditHash,
        idempotency_key: idempotencyKey,
        order: {
          conid: parsedConid,
          side,
          quantity: parsedQuantity,
          limit_price: parsedLimit,
        },
      },
    });
    setPreviewLoading(false);

    if (error) {
      toast({
        title: "IBKR preview unavailable",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const response = data as IbkrPreviewResponse;
    setResult(response);
    if (!response.ok) {
      toast({
        title: "IBKR preview rejected",
        description: response.error || response.code || "The provider preview did not clear its validation gates.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="rounded-md border border-border/70 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">Interactive Brokers · What-If preview</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Server-side market snapshot and commission/margin preview only. This adapter has no order-submission capability.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={configured ? "outline" : "secondary"}>
            {configured === true ? "server session configured" : configured === false ? "not configured" : "status unknown"}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={statusLoading}
            onClick={loadStatus}
          >
            {statusLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {configured !== true ? (
        <div className="rounded-md border border-dashed p-3 text-[10px] text-muted-foreground">
          {configured === false
            ? "The IBKR adapter exists in AICIS, but no authenticated server-side IBKR session is configured. Client-supplied credentials are not accepted."
            : "Provider capability status could not be confirmed. AICIS will not assume the broker session is available."}
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Input
              value={conid}
              onChange={(event) => {
                setConid(event.target.value);
                setResult(null);
              }}
              inputMode="numeric"
              placeholder="IBKR conid"
            />
            <div className="flex gap-1">
              <Button
                type="button"
                variant={side === "BUY" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setSide("BUY");
                  setResult(null);
                }}
              >
                BUY
              </Button>
              <Button
                type="button"
                variant={side === "SELL" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setSide("SELL");
                  setResult(null);
                }}
              >
                SELL
              </Button>
            </div>
            <Input
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
                setResult(null);
              }}
              inputMode="decimal"
              placeholder="Quantity"
            />
            <Input
              value={limitPrice}
              onChange={(event) => {
                setLimitPrice(event.target.value);
                setResult(null);
              }}
              inputMode="decimal"
              placeholder="Limit price"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              v1 supports DAY limit-order what-if previews only.
            </p>
            <Button type="button" size="sm" onClick={runPreview} disabled={previewLoading}>
              {previewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Run IBKR what-if
            </Button>
          </div>
        </>
      )}

      {result?.ok && result.preview ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Bid" value={format(result.preview.market_snapshot.bid)} />
            <Metric label="Ask" value={format(result.preview.market_snapshot.ask)} />
            <Metric label="Commission" value={format(result.preview.provider_preview.commission, result.preview.provider_preview.currency)} />
            <Metric label="Preview total" value={format(result.preview.provider_preview.total, result.preview.provider_preview.currency)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Initial margin change"
              value={format(result.preview.provider_preview.initial_margin.change, result.preview.provider_preview.currency)}
            />
            <Metric
              label="Maintenance margin change"
              value={format(result.preview.provider_preview.maintenance_margin.change, result.preview.provider_preview.currency)}
            />
          </div>

          {result.preview.provider_preview.warning ? (
            <div className="rounded-md border border-dashed p-3 text-[10px] text-muted-foreground">
              Provider warning: {result.preview.provider_preview.warning}
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-md bg-muted/20 p-3 text-[10px] text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Provider-attested what-if only · approval not granted · order endpoint not called · order not submitted · money not moved.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 p-2.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs font-semibold">{value}</p>
    </div>
  );
}
