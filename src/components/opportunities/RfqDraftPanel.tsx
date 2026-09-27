import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Clipboard, FileText, Loader2, ShieldAlert } from "lucide-react";

type EvidenceRef = Record<string, unknown>;

type OfferSummary = {
  id?: string;
  role?: string;
  name?: string;
  country?: string;
  registration_id?: string | null;
  official_website?: string | null;
  product_id?: string | null;
  incoterm?: string | null;
  payment_terms?: string | null;
  compliance_status?: string | null;
  contact?: {
    company?: string;
    channel?: string;
    value?: string | null;
    source?: string | null;
  } | null;
  evidence_refs?: EvidenceRef[];
};

type Candidate = {
  candidate_id: string;
  title: string;
  product?: {
    id?: string;
    name?: string;
    unit?: string;
    specification?: string | null;
  } | null;
  quantity?: number | null;
  unit?: string | null;
  currency?: string | null;
  execution_dossier: {
    where: {
      source?: OfferSummary | null;
      destination?: OfferSummary | null;
    };
  };
};

type RfqDraftResponse = {
  ok: boolean;
  reasons?: string[];
  error?: string;
  draft?: {
    rfq_id: string;
    message: { subject: string; body: string };
    counterparty: { legal_name: string | null };
    response_deadline: string | null;
  };
  audit?: { hash?: string };
  approval?: {
    approved_to_send: false;
    sent: false;
  };
  send_boundary?: {
    outbound_message_sent: false;
    approved_to_send: false;
    approval_token: null;
  };
};

type RfqNormalizeResponse = {
  ok: boolean;
  reasons?: string[];
  error?: string;
  normalized_response?: Record<string, unknown>;
  audit?: { hash?: string };
  next_required_gate?: string;
  transaction_eligible?: false;
};

function deadlineDefault() {
  const date = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function host(url?: string | null) {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function seedFromCandidate(candidate: Candidate, strategicAuditHash: string) {
  const source = candidate.execution_dossier.where.source;
  const destination = candidate.execution_dossier.where.destination;
  const product = candidate.product || {};
  const sourceContact = source?.contact || null;
  const destinationLabel = [destination?.name, destination?.country].filter(Boolean).join(", ");

  return {
    candidate_id: candidate.candidate_id,
    strategic_audit_hash: strategicAuditHash,
    counterparty: {
      id: source?.id || "",
      role: "supplier",
      legal_name: source?.name || "",
      jurisdiction: source?.country || "",
      registration_id: source?.registration_id || "",
      compliance_status: source?.compliance_status || "unknown",
      official_website: source?.official_website || "",
      evidence_refs: source?.evidence_refs || [],
    },
    contact: {
      company: sourceContact?.company || source?.name || "",
      channel: sourceContact?.channel || "",
      value: sourceContact?.value || "",
      source: sourceContact?.source || source?.official_website || "",
    },
    product: {
      id: product.id || source?.product_id || "",
      name: product.name || "",
      specification: product.specification || "",
    },
    quantity: {
      amount: candidate.quantity ?? null,
      unit: candidate.unit || product.unit || "",
    },
    commercial: {
      destination: destinationLabel,
      requested_incoterms: source?.incoterm ? [source.incoterm] : [],
      currency_preferences: candidate.currency ? [candidate.currency] : [],
      requested_payment_terms: source?.payment_terms ? [source.payment_terms] : [],
      delivery_window: "",
    },
    quality: {
      requirements: [],
      certifications: [],
    },
    response_deadline: deadlineDefault(),
  };
}

export function RfqDraftPanel({
  candidate,
  strategicAuditHash,
}: {
  candidate: Candidate;
  strategicAuditHash: string;
}) {
  const [draftInput, setDraftInput] = useState(() =>
    JSON.stringify(seedFromCandidate(candidate, strategicAuditHash), null, 2)
  );
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftResult, setDraftResult] = useState<RfqDraftResponse | null>(null);
  const [responseInput, setResponseInput] = useState("");
  const [responseLoading, setResponseLoading] = useState(false);
  const [responseResult, setResponseResult] = useState<RfqNormalizeResponse | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    setDraftInput(JSON.stringify(seedFromCandidate(candidate, strategicAuditHash), null, 2));
    setDraftResult(null);
    setResponseResult(null);
  }, [candidate.candidate_id, strategicAuditHash]);

  const source = candidate.execution_dossier.where.source;
  const contactReady = useMemo(() => Boolean(
    source?.contact?.value &&
    source?.contact?.channel &&
    source?.contact?.source
  ), [source]);

  const generate = async () => {
    let input: unknown;
    try {
      input = JSON.parse(draftInput);
    } catch {
      toast({
        title: "Invalid RFQ JSON",
        description: "Fix the RFQ input before generating the draft.",
        variant: "destructive",
      });
      return;
    }

    setDraftLoading(true);
    const { data, error } = await supabase.functions.invoke("generate-rfq-draft", {
      body: { input, as_of: new Date().toISOString() },
    });
    setDraftLoading(false);

    if (error) {
      toast({ title: "RFQ draft failed", description: error.message, variant: "destructive" });
      return;
    }

    const result = data as RfqDraftResponse;
    setDraftResult(result);
    if (!result.ok) {
      toast({
        title: "RFQ input incomplete",
        description: result.reasons?.join(", ") || result.error || "The RFQ draft did not clear its gates.",
        variant: "destructive",
      });
    }
  };

  const copyMessage = async () => {
    const message = draftResult?.draft?.message;
    if (!message) return;
    await navigator.clipboard.writeText(message.subject + "\n\n" + message.body);
    toast({
      title: "RFQ copied",
      description: "The draft was copied for human review. Nothing was sent.",
    });
  };

  const normalizeResponse = async () => {
    let response: unknown;
    try {
      response = JSON.parse(responseInput);
    } catch {
      toast({
        title: "Invalid response JSON",
        description: "Paste a valid attributable RFQ response before normalization.",
        variant: "destructive",
      });
      return;
    }

    setResponseLoading(true);
    const { data, error } = await supabase.functions.invoke("normalize-rfq-response", {
      body: { response, as_of: new Date().toISOString() },
    });
    setResponseLoading(false);

    if (error) {
      toast({ title: "RFQ response failed", description: error.message, variant: "destructive" });
      return;
    }

    const result = data as RfqNormalizeResponse;
    setResponseResult(result);
    if (!result.ok) {
      toast({
        title: "RFQ response rejected",
        description: result.reasons?.join(", ") || result.error || "The response evidence is incomplete.",
        variant: "destructive",
      });
    }
  };

  const seedVerification = () => {
    const normalized = responseResult?.normalized_response;
    if (!normalized) return;

    const officialWebsite = String(normalized.official_website || "");
    const evidenceRefs = Array.isArray(normalized.evidence_refs) ? normalized.evidence_refs : [];

    const dossier = {
      as_of: new Date().toISOString(),
      role: normalized.role || "supplier",
      legal_identity: {
        legal_name: normalized.name || "",
        jurisdiction: normalized.country || "",
        registration_id: normalized.registration_id || "",
        evidence_refs: [],
      },
      official_site: {
        domain: host(officialWebsite),
        url: officialWebsite,
        evidence_refs: [],
      },
      compliance: {
        status: "review",
        screened_at: "",
        evidence_refs: [],
      },
      commercial_quote: {
        quote_id: normalized.id || "",
        product_id: normalized.product_id || "",
        unit_price: normalized.unit_price ?? 0,
        currency: normalized.currency || "",
        min_quantity: normalized.min_quantity ?? null,
        max_quantity: normalized.max_quantity ?? null,
        incoterm: normalized.incoterm || "",
        valid_until: normalized.quote_valid_until || "",
        evidence_status: "contractually_indicated",
        evidence_refs: evidenceRefs,
      },
      capacity: {
        status: "observed",
        evidence_refs: [],
      },
      payment_terms: {
        terms: normalized.payment_terms || "",
        evidence_refs: [],
      },
      contact_channels: [],
      evidence_score: 0,
      counterparty_quality_score: 50,
    };

    window.dispatchEvent(new CustomEvent("aicis:verify-counterparty", {
      detail: { dossier },
    }));
    toast({
      title: "Response sent to verification",
      description: "The quote evidence was carried forward, but legal identity, official site, compliance, capacity and payment-term evidence remain deliberately incomplete.",
    });
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Supplier RFQ</p>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Prepare a quote request from the verified transaction candidate. Drafting and copying are allowed; sending remains a separate human-approved action and is not implemented here.
          </p>
        </div>
        <Badge variant={contactReady ? "outline" : "secondary"}>
          {contactReady ? "business contact available" : "contact evidence incomplete"}
        </Badge>
      </div>

      <Textarea
        value={draftInput}
        onChange={(event) => {
          setDraftInput(event.target.value);
          setDraftResult(null);
        }}
        className="min-h-[260px] font-mono text-xs"
      />

      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={generate} disabled={draftLoading}>
          {draftLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Generate RFQ draft
        </Button>
      </div>

      {draftResult?.ok && draftResult.draft ? (
        <div className="space-y-3">
          <div className="rounded-md bg-muted/20 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Subject</p>
            <p className="mt-1 text-xs font-medium">{draftResult.draft.message.subject}</p>
          </div>
          <pre className="max-h-[380px] overflow-auto whitespace-pre-wrap rounded-md border border-border/70 p-3 text-[11px]">
            {draftResult.draft.message.body}
          </pre>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              RFQ fingerprint: <code>{draftResult.audit?.hash?.slice(0, 16) || "—"}…</code>
            </p>
            <Button type="button" size="sm" variant="outline" onClick={copyMessage} className="gap-2">
              <Clipboard className="h-3.5 w-3.5" />
              Copy for review
            </Button>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-[10px] text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              approved_to_send=false · sent=false · approval token absent · no purchase order · no contract · no money movement.
            </span>
          </div>
        </div>
      ) : null}

      <div className="border-t border-border/70 pt-4 space-y-3">
        <div>
          <p className="text-xs font-semibold">Normalize returned quote</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Paste an attributable RFQ response after it arrives. Normalization never makes it transaction-eligible; it must pass Counterparty Verification again.
          </p>
        </div>
        <Textarea
          value={responseInput}
          onChange={(event) => {
            setResponseInput(event.target.value);
            setResponseResult(null);
          }}
          className="min-h-[220px] font-mono text-xs"
          placeholder='{"rfq_id":"...","quote_id":"...","role":"supplier","counterparty_id":"...","legal_name":"...","jurisdiction":"...","product_id":"...","unit_price":0,"currency":"EUR","quantity":0,"quantity_unit":"tonnes","incoterm":"CIF","payment_terms":"...","valid_until":"...","evidence_refs":[...]}'
        />
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={normalizeResponse}
            disabled={responseLoading || !responseInput.trim()}
          >
            {responseLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Normalize response
          </Button>
        </div>

        {responseResult?.ok && responseResult.normalized_response ? (
          <div className="space-y-2">
            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md bg-muted/20 p-3 text-[10px]">
              {JSON.stringify(responseResult.normalized_response, null, 2)}
            </pre>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                transaction_eligible=false · next gate: {responseResult.next_required_gate || "verification"}
              </p>
              <Button type="button" size="sm" onClick={seedVerification}>
                Verify response dossier
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
