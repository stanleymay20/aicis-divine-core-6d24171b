import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRelevancePreferences } from "@/hooks/useRelevancePreferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { TransactionPathLab } from "@/components/opportunities/TransactionPathLab";
import {
  ArrowRight,
  CircleDollarSign,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";

type OpportunityProfile = {
  objective: "balanced" | "net_profit" | "return_on_capital" | "profit_velocity" | "capital_preservation";
  risk_tolerance: "low" | "balanced" | "high";
  capital_available: number | null;
  max_cycle_days: number;
  min_base_margin_pct: number;
  min_evidence_score: number;
  min_relevance_score: number;
  minimum_rank_score: number;
  max_single_opportunity_capital_pct: number;
  reserve_pct: number;
  max_country_capital_pct: number;
  max_sector_capital_pct: number;
  max_positions: number;
  allowed_transaction_types: string[];
  excluded_countries: string[];
  excluded_sectors: string[];
  manual_approval_required: true;
};

const DEFAULT_PROFILE: OpportunityProfile = {
  objective: "balanced",
  risk_tolerance: "balanced",
  capital_available: null,
  max_cycle_days: 90,
  min_base_margin_pct: 3,
  min_evidence_score: 60,
  min_relevance_score: 45,
  minimum_rank_score: 58,
  max_single_opportunity_capital_pct: 35,
  reserve_pct: 10,
  max_country_capital_pct: 60,
  max_sector_capital_pct: 60,
  max_positions: 8,
  allowed_transaction_types: [],
  excluded_countries: [],
  excluded_sectors: [],
  manual_approval_required: true,
};

type ResearchSignal = {
  signal_id: string;
  relevance_score: number;
  relevance_tier: string;
  relevance_reason: Record<string, unknown> | null;
  computed_at: string;
  signal?: {
    id: string;
    title: string;
    summary: string | null;
    category: string | null;
    affected_countries: string[] | null;
    affected_sectors: string[] | null;
    urgency_score: number | null;
    impact_score: number | null;
    confidence_score: number | null;
    latest_update_at: string | null;
  };
};

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function OpportunityRadar() {
  const { user } = useAuth();
  const { prefs, save, loaded } = useRelevancePreferences();
  const { toast } = useToast();
  const [profile, setProfile] = useState<OpportunityProfile>(DEFAULT_PROFILE);
  const [saving, setSaving] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [typesText, setTypesText] = useState("");

  useEffect(() => {
    if (!loaded) return;
    const raw = (prefs.alert_preferences?.opportunity_profile ?? {}) as Partial<OpportunityProfile>;
    const next = { ...DEFAULT_PROFILE, ...raw, manual_approval_required: true };
    setProfile(next);
    setTypesText((next.allowed_transaction_types || []).join(", "));
  }, [loaded, prefs.alert_preferences]);

  const {
    data: researchQueue = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["opportunity-research-queue", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<ResearchSignal[]> => {
      if (!user?.id) return [];
      const { data: scores, error: scoreError } = await (supabase as any)
        .from("signal_relevance_scores")
        .select("signal_id,relevance_score,relevance_tier,relevance_reason,computed_at")
        .eq("user_id", user.id)
        .order("relevance_score", { ascending: false })
        .limit(12);
      if (scoreError) throw scoreError;
      if (!scores?.length) return [];

      const ids = scores.map((row: any) => row.signal_id).filter(Boolean);
      const { data: signals, error: signalError } = await (supabase as any)
        .from("global_signals")
        .select("id,title,summary,category,affected_countries,affected_sectors,urgency_score,impact_score,confidence_score,latest_update_at")
        .in("id", ids);
      if (signalError) throw signalError;

      const byId = new Map((signals || []).map((signal: any) => [signal.id, signal]));
      return scores.map((row: any) => ({ ...row, signal: byId.get(row.signal_id) }));
    },
    staleTime: 60_000,
  });

  const configuredContext = useMemo(() => {
    return (
      prefs.countries.length +
      prefs.operating_regions.length +
      prefs.industries.length +
      prefs.domains.length +
      prefs.watched_entities.length +
      prefs.keywords.length +
      prefs.risk_priorities.length
    );
  }, [prefs]);

  const updateProfile = <K extends keyof OpportunityProfile>(key: K, value: OpportunityProfile[K]) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const saveProfile = async () => {
    setSaving(true);
    const allowed = typesText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const nextProfile = { ...profile, allowed_transaction_types: allowed, manual_approval_required: true } as OpportunityProfile;
    const result = await save({
      ...prefs,
      alert_preferences: {
        ...prefs.alert_preferences,
        opportunity_profile: nextProfile,
      },
    });
    setSaving(false);
    if (result.error) {
      toast({ title: "Could not save opportunity preferences", description: result.error.message, variant: "destructive" });
      return;
    }
    setProfile(nextProfile);
    toast({ title: "Opportunity preferences saved", description: "AICIS will use these constraints when ranking transaction candidates." });
  };

  const rescoreSignals = async () => {
    setRescoring(true);
    const { error } = await supabase.functions.invoke("score-signal-relevance", {
      body: { limit: 500, bootstrap: true },
    });
    setRescoring(false);
    if (error) {
      toast({ title: "Relevance refresh failed", description: error.message, variant: "destructive" });
      return;
    }
    await refetch();
    toast({ title: "Relevance refreshed", description: "The research queue now reflects your latest AICIS preferences." });
  };

  return (
    <div className="container mx-auto max-w-[1400px] px-4 py-6 space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Opportunity Radar</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Personalized opportunity research and transaction ranking. AICIS ranks only verified candidate economics and keeps execution behind explicit human approval.
          </p>
        </div>
        <Badge variant="outline" className="w-fit gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />
          Human approval required
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Your transaction objective
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            These rules sit on top of your existing relevance profile. They determine which opportunities are suitable for you, not merely which opportunities have the largest headline profit.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Capital available">
            <Input
              inputMode="decimal"
              value={profile.capital_available ?? ""}
              placeholder="e.g. 10000"
              onChange={(e) => updateProfile("capital_available", e.target.value === "" ? null : toNumber(e.target.value, 0))}
            />
          </Field>
          <Field label="Objective">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={profile.objective}
              onChange={(e) => updateProfile("objective", e.target.value as OpportunityProfile["objective"])}
            >
              <option value="balanced">Balanced</option>
              <option value="net_profit">Maximize net profit</option>
              <option value="return_on_capital">Maximize return on capital</option>
              <option value="profit_velocity">Maximize profit velocity</option>
              <option value="capital_preservation">Preserve capital</option>
            </select>
          </Field>
          <Field label="Risk tolerance">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={profile.risk_tolerance}
              onChange={(e) => updateProfile("risk_tolerance", e.target.value as OpportunityProfile["risk_tolerance"])}
            >
              <option value="low">Low</option>
              <option value="balanced">Balanced</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Maximum cycle (days)">
            <Input value={profile.max_cycle_days} onChange={(e) => updateProfile("max_cycle_days", toNumber(e.target.value, 90))} />
          </Field>
          <Field label="Minimum base margin %">
            <Input value={profile.min_base_margin_pct} onChange={(e) => updateProfile("min_base_margin_pct", toNumber(e.target.value, 3))} />
          </Field>
          <Field label="Minimum evidence score">
            <Input value={profile.min_evidence_score} onChange={(e) => updateProfile("min_evidence_score", toNumber(e.target.value, 60))} />
          </Field>
          <Field label="Minimum relevance score">
            <Input value={profile.min_relevance_score} onChange={(e) => updateProfile("min_relevance_score", toNumber(e.target.value, 45))} />
          </Field>
          <Field label="Max capital in one opportunity %">
            <Input
              value={profile.max_single_opportunity_capital_pct}
              onChange={(e) => updateProfile("max_single_opportunity_capital_pct", toNumber(e.target.value, 35))}
            />
          </Field>
          <Field label="Minimum overall rank score">
            <Input
              value={profile.minimum_rank_score}
              onChange={(e) => updateProfile("minimum_rank_score", toNumber(e.target.value, 58))}
            />
          </Field>
          <Field label="Cash reserve %">
            <Input
              value={profile.reserve_pct}
              onChange={(e) => updateProfile("reserve_pct", toNumber(e.target.value, 10))}
            />
          </Field>
          <Field label="Max country capital %">
            <Input
              value={profile.max_country_capital_pct}
              onChange={(e) => updateProfile("max_country_capital_pct", toNumber(e.target.value, 60))}
            />
          </Field>
          <Field label="Max sector capital %">
            <Input
              value={profile.max_sector_capital_pct}
              onChange={(e) => updateProfile("max_sector_capital_pct", toNumber(e.target.value, 60))}
            />
          </Field>
          <Field label="Maximum simultaneous positions">
            <Input
              value={profile.max_positions}
              onChange={(e) => updateProfile("max_positions", toNumber(e.target.value, 8))}
            />
          </Field>
          <div className="md:col-span-2 xl:col-span-4">
            <Field label="Allowed transaction types (optional, comma-separated)">
              <Input
                value={typesText}
                onChange={(e) => setTypesText(e.target.value)}
                placeholder="physical_trade, brokerage, procurement, public_market"
              />
            </Field>
          </div>
          <div className="md:col-span-2 xl:col-span-4 flex justify-end">
            <Button onClick={saveProfile} disabled={saving || !loaded} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save opportunity preferences
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              Personalization
            </div>
            <p className="text-2xl font-semibold">{configuredContext}</p>
            <p className="text-xs text-muted-foreground">
              configured relevance dimensions across countries, sectors, entities, keywords and priorities.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-2">
            <div className="text-sm font-semibold">Transaction truth floor</div>
            <p className="text-sm">Verified economics only</p>
            <p className="text-xs text-muted-foreground">
              Synthetic, missing or unverified cost/revenue inputs are rejected instead of ranked as profitable opportunities.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-2">
            <div className="text-sm font-semibold">Execution boundary</div>
            <p className="text-sm">Recommendation ≠ execution</p>
            <p className="text-xs text-muted-foreground">
              The engine can rank and explain candidates, but money movement and contractual commitments remain separately authorized.
            </p>
          </CardContent>
        </Card>
      </div>

      <TransactionPathLab />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Relevant opportunity research queue</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                These are high-relevance AICIS signals to investigate for opportunities. They are not executable transaction recommendations until verified quotes, counterparties, full landed costs and compliance checks are attached.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={rescoreSignals} disabled={rescoring} className="gap-2">
              {rescoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh relevance
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading personalized signals…
            </div>
          ) : researchQueue.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No personalized signal scores are available yet. Refresh relevance or configure your relevance preferences first.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {researchQueue.map((item) => (
                <div key={item.signal_id} className="py-4 first:pt-0 last:pb-0 flex gap-4">
                  <div className="shrink-0 w-14 text-center">
                    <div className="text-xl font-semibold tabular-nums">{Math.round(item.relevance_score)}</div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">relevance</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{item.signal?.title || "Signal"}</h3>
                      <Badge variant="outline" className="text-[10px]">{item.relevance_tier}</Badge>
                      {item.signal?.category && <Badge variant="secondary" className="text-[10px]">{item.signal.category}</Badge>}
                    </div>
                    {item.signal?.summary && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.signal.summary}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                      {(item.signal?.affected_countries || []).slice(0, 4).map((country) => <span key={country}>{country}</span>)}
                      {(item.signal?.affected_sectors || []).slice(0, 4).map((sector) => <span key={sector}>· {sector}</span>)}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
