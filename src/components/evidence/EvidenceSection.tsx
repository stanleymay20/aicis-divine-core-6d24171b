import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronRight, ShieldCheck, FileText, Building2, Newspaper, Database, ExternalLink, Hash, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Expandable "Evidence" section.
 * Renders the audit chain behind a score or signal:
 *  - Contributing signals (source label, weight, last updated)
 *  - SHA-256 evidence hash of the raw inputs
 *
 * Empty state is intentional and explicit — trust = visible provenance.
 */

type EvidenceRow = {
  id: string;
  title: string;
  source_name: string;
  source_kind: "official" | "news" | "indicator" | "satellite" | "other";
  weight: number; // 0..1
  updated_at: string | null;
  url?: string | null;
  hash?: string | null;
};

interface BaseProps {
  defaultOpen?: boolean;
  className?: string;
  label?: string;
}

type Props =
  | (BaseProps & { mode: "country"; iso3: string })
  | (BaseProps & { mode: "signal"; signalId: string; evidenceHash?: string | null });

const KIND_ICON = {
  official: Building2,
  news: Newspaper,
  indicator: Database,
  satellite: Database,
  other: FileText,
};

const KIND_LABEL = {
  official: "Government / official",
  news: "News feed",
  indicator: "Economic indicator",
  satellite: "Satellite / sensor",
  other: "Other source",
};

function classifyKind(sourceType?: string | null, sourceName?: string | null): EvidenceRow["source_kind"] {
  const t = (sourceType || "").toLowerCase();
  const n = (sourceName || "").toLowerCase();
  if (t === "official" || /\bgov|ministry|ministero|imf|world bank|un |unhcr|who\b/.test(n)) return "official";
  if (t === "indicator" || /imf|fred|comtrade|oecd|eurostat/.test(n)) return "indicator";
  if (t === "satellite" || /nasa|noaa|firms|sentinel/.test(n)) return "satellite";
  if (t === "news" || /reuters|ap |bbc|bloomberg|guardian|times/.test(n)) return "news";
  return "other";
}

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function useCountryEvidence(iso3: string, enabled: boolean) {
  return useQuery({
    queryKey: ["evidence-country", iso3],
    enabled: enabled && !!iso3,
    staleTime: 60_000,
    queryFn: async (): Promise<EvidenceRow[]> => {
      const { data } = await supabase
        .from("global_signals")
        .select("id,title,canonical_source_name,ingestion_source,source_trust_tier,confidence_score,impact_score,ingested_at,evidence_hash,source_references")
        .contains("affected_countries", [iso3])
        .order("ingested_at", { ascending: false })
        .limit(8);
      return (data ?? []).map((s: any): EvidenceRow => {
        const name = s.canonical_source_name || s.ingestion_source || "Unknown";
        const url = Array.isArray(s.source_references) && s.source_references[0]?.url;
        const weight = Math.max(0, Math.min(1, ((s.confidence_score ?? 0) * 0.6 + (s.impact_score ?? 0) * 0.4) / 100));
        return {
          id: s.id,
          title: s.title,
          source_name: name,
          source_kind: classifyKind(s.source_trust_tier, name),
          weight,
          updated_at: s.ingested_at,
          url: url || null,
          hash: s.evidence_hash || null,
        };
      });
    },
  });
}

function useSignalEvidence(signalId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["evidence-signal", signalId],
    enabled: enabled && !!signalId,
    staleTime: 60_000,
    queryFn: async (): Promise<EvidenceRow[]> => {
      const { data } = await supabase
        .from("intelligence_citations")
        .select("id,source_name,source_url,source_type,confidence_weight,retrieved_at,published_at,source_hash,publisher_key")
        .eq("subject_type", "global_signals")
        .eq("subject_id", signalId)
        .order("confidence_weight", { ascending: false })
        .limit(12);
      return (data ?? []).map((c: any): EvidenceRow => ({
        id: c.id,
        title: c.source_name,
        source_name: c.source_name,
        source_kind: classifyKind(c.source_type, c.source_name),
        weight: Number(c.confidence_weight ?? 0),
        updated_at: c.retrieved_at || c.published_at,
        url: c.source_url,
        hash: c.source_hash,
      }));
    },
  });
}

export function EvidenceSection(props: Props) {
  const [open, setOpen] = useState(!!props.defaultOpen);

  const country = useCountryEvidence(
    props.mode === "country" ? props.iso3 : "",
    open && props.mode === "country",
  );
  const signal = useSignalEvidence(
    props.mode === "signal" ? props.signalId : "",
    open && props.mode === "signal",
  );

  const isLoading = props.mode === "country" ? country.isLoading : signal.isLoading;
  const rows = (props.mode === "country" ? country.data : signal.data) ?? [];

  // Composite SHA-256 of the raw inputs (id|hash|updated_at), computed client-side
  // so users can independently verify what went into the score.
  const [composite, setComposite] = useState<string>("");
  useEffect(() => {
    if (props.mode === "signal" && props.evidenceHash) {
      setComposite(props.evidenceHash);
      return;
    }
    if (!rows.length) {
      setComposite("");
      return;
    }
    const seed = rows
      .map((r) => `${r.id}|${r.hash ?? ""}|${r.updated_at ?? ""}`)
      .join("\n");
    sha256(seed).then(setComposite);
  }, [rows, props]);

  const totalWeight = useMemo(
    () => rows.reduce((s, r) => s + (r.weight || 0), 0) || 1,
    [rows],
  );

  return (
    <section
      className={cn(
        "rounded border border-border/60 bg-muted/10",
        props.className,
      )}
      aria-label="Evidence chain"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          Evidence
          {!isLoading && rows.length > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
              {rows.length}
            </span>
          )}
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border/60 px-3 py-2 space-y-2">
          {isLoading ? (
            <div className="space-y-1.5">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded border border-dashed border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-700 dark:text-amber-400">
              Evidence chain pending — signals are being collected.
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {rows.map((r) => {
                const Icon = KIND_ICON[r.source_kind];
                const pct = Math.round((r.weight / totalWeight) * 100);
                const ts = r.updated_at ? new Date(r.updated_at) : null;
                return (
                  <li key={r.id} className="py-1.5">
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {r.url ? (
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate text-[11px] font-medium text-primary hover:underline"
                              title={r.title}
                            >
                              {r.source_name}
                              <ExternalLink className="ml-0.5 inline h-2.5 w-2.5 opacity-60" />
                            </a>
                          ) : (
                            <span className="truncate text-[11px] font-medium">{r.source_name}</span>
                          )}
                          <span className="ml-auto rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
                            {pct}%
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{KIND_LABEL[r.source_kind]}</span>
                          {ts && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              {ts.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                            </span>
                          )}
                          {r.hash && (
                            <span className="flex items-center gap-0.5 font-mono" title={r.hash}>
                              <Hash className="h-2.5 w-2.5" />
                              {r.hash.slice(0, 8)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {composite && (
            <div className="mt-2 flex items-start gap-1.5 rounded bg-background/60 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
              <Hash className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <div className="uppercase tracking-wide text-[9px]">Composite SHA-256</div>
                <div className="break-all text-foreground/80" title={composite}>{composite}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
