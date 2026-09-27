import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, ShieldCheck, ShieldX } from "lucide-react";

type ScreenMatch = {
  source?: string;
  source_authority?: string;
  record_id?: string | null;
  primary_name?: string;
  aliases?: string[];
  programs?: string[];
  name_match?: boolean;
  identifier_match?: boolean;
};

type EvidenceRef = {
  source_id?: string;
  source_type?: string;
  source_url?: string;
  observed_at?: string;
  sha256?: string;
};

type SourceStatus = {
  source?: string;
  ok?: boolean;
  error?: string;
  records?: number;
  evidence_ref?: EvidenceRef;
};

type ScreenResponse = {
  ok: boolean;
  legal_name?: string;
  screen?: {
    status?: string;
    matches?: ScreenMatch[];
    missing_sources?: string[];
    reasons?: string[];
    compliance_status?: string;
  };
  coverage?: {
    required_sources?: string[];
    checked_sources?: string[];
    missing_sources?: string[];
    complete?: boolean;
  };
  sources?: SourceStatus[];
  compliance_boundary?: {
    automatic_legal_clearance?: boolean;
    human_compliance_review_required?: boolean;
    transaction_eligible?: boolean;
    notice?: string;
  };
  error?: string;
};

const SOURCE_LABELS: Record<string, string> = {
  ofac_sdn: "US OFAC SDN",
  un_consolidated: "UN Consolidated",
  uk_sanctions: "UK Sanctions List",
  eu_sanctions: "EU Consolidated",
};

export function SanctionsScreenPanel() {
  const [legalName, setLegalName] = useState("");
  const [registrationId, setRegistrationId] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ScreenResponse | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ legal_name?: string }>).detail || {};
      if (detail.legal_name) setLegalName(detail.legal_name);
      window.requestAnimationFrame(() => {
        document.getElementById("sanctions-screen")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    window.addEventListener("aicis:screen-counterparty", handler as EventListener);
    return () => window.removeEventListener("aicis:screen-counterparty", handler as EventListener);
  }, []);

  const aliases = useMemo(
    () => aliasesText.split(",").map((value) => value.trim()).filter(Boolean),
    [aliasesText],
  );

  const runScreen = async () => {
    if (!legalName.trim()) {
      toast({ title: "Legal name required", description: "Enter the company's legal name before screening.", variant: "destructive" });
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("screen-transaction-counterparty", {
      body: {
        legal_name: legalName.trim(),
        registration_id: registrationId.trim() || null,
        aliases,
      },
    });
    setLoading(false);

    if (error) {
      toast({ title: "Sanctions screening failed", description: error.message, variant: "destructive" });
      return;
    }

    const result = data as ScreenResponse;
    setResponse(result);
    if (!result.ok) {
      toast({
        title: "Sanctions screening failed",
        description: result.error || "No screening result was returned.",
        variant: "destructive",
      });
    }
  };

  const matches = response?.screen?.matches || [];
  const checked = response?.coverage?.checked_sources || [];
  const missing = response?.coverage?.missing_sources || [];

  return (
    <Card id="sanctions-screen">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Official Sanctions Screening
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Screen a legal entity against current official sanctions snapshots. A match is a review trigger, not an automatic legal conclusion,
          and a no-match is not a clearance while required sources remain unchecked.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1.5fr_auto]">
          <Input value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Legal company name" />
          <Input value={registrationId} onChange={(event) => setRegistrationId(event.target.value)} placeholder="Registration ID (optional)" />
          <Input value={aliasesText} onChange={(event) => setAliasesText(event.target.value)} placeholder="Aliases, comma-separated" />
          <Button onClick={runScreen} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Screen
          </Button>
        </div>

        {response?.ok ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={matches.length ? "destructive" : "secondary"}>
                {matches.length ? "potential match — review required" : "no exact match in checked sources"}
              </Badge>
              <Badge variant="outline">{checked.length} sources checked</Badge>
              {missing.length ? <Badge variant="outline">{missing.length} required sources missing</Badge> : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {(response.coverage?.required_sources || []).map((source) => {
                const wasChecked = checked.includes(source);
                const status = response.sources?.find((item) => item.source === source);
                return (
                  <div key={source} className="rounded-md border border-border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium">{SOURCE_LABELS[source] || source}</p>
                      {wasChecked ? (
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <ShieldX className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {wasChecked
                        ? `${status?.records ?? 0} records loaded`
                        : status?.error
                          ? `Unavailable: ${status.error}`
                          : "Not checked in this run"}
                    </p>
                  </div>
                );
              })}
            </div>

            {matches.length ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold">Potential official-list matches</p>
                {matches.map((match, index) => (
                  <div key={(match.source || "source") + "-" + (match.record_id || index)} className="rounded-md border border-destructive/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{match.primary_name || "Unnamed record"}</p>
                      <Badge variant="destructive">{SOURCE_LABELS[match.source || ""] || match.source || "official source"}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Record {match.record_id || "—"}
                      {match.name_match ? " · exact normalized name match" : ""}
                      {match.identifier_match ? " · identifier match" : ""}
                    </p>
                    {match.programs?.length ? (
                      <p className="mt-1 text-[10px] text-muted-foreground">{match.programs.join(", ")}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="rounded-md bg-muted/25 p-3 text-[11px] text-muted-foreground">
              {response.compliance_boundary?.notice || "Human compliance review remains required before transaction eligibility."}
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const evidenceRefs = (response.sources || [])
                    .map((source) => source.evidence_ref)
                    .filter((ref): ref is EvidenceRef => Boolean(ref?.source_id && ref?.observed_at && ref?.sha256));
                  const screenedAt = evidenceRefs
                    .map((ref) => ref.observed_at || "")
                    .filter(Boolean)
                    .sort()
                    .at(-1) || new Date().toISOString();
                  window.dispatchEvent(new CustomEvent("aicis:verify-counterparty", {
                    detail: {
                      dossier: {
                        as_of: new Date().toISOString(),
                        role: "supplier",
                        legal_identity: {
                          legal_name: legalName.trim(),
                          jurisdiction: "",
                          registration_id: registrationId.trim(),
                          evidence_refs: [],
                        },
                        official_site: {
                          domain: "",
                          url: "",
                          evidence_refs: [],
                        },
                        compliance: {
                          status: "review",
                          screened_at: screenedAt,
                          evidence_refs: evidenceRefs,
                        },
                        commercial_quote: {
                          quote_id: "",
                          product_id: "",
                          unit_price: 0,
                          currency: "",
                          min_quantity: null,
                          max_quantity: null,
                          incoterm: "",
                          valid_until: "",
                          evidence_status: "verified_quote",
                          evidence_refs: [],
                        },
                        capacity: {
                          status: "verified",
                          evidence_refs: [],
                        },
                        payment_terms: {
                          terms: "",
                          evidence_refs: [],
                        },
                        contact_channels: [],
                        evidence_score: 0,
                        counterparty_quality_score: 50,
                      },
                    },
                  }));
                }}
              >
                Prepare verification dossier
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
