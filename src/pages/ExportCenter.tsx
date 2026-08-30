import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Download, FileDown, Lock, Loader2, ShieldCheck, History, ExternalLink, Eye, Archive } from "lucide-react";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { formatDistanceToNow } from "date-fns";

type DatasetKey = "local_events" | "early_warnings" | "geo_audit"
                | "country_corrections" | "normalized_events" | "training_dataset"
                | "global_signals";

const DATASETS: { key: DatasetKey; label: string; description: string; tier: "public"|"private"|"training" }[] = [
  { key: "global_signals",      label: "Global Signals (raw)",     description: "All ingested signals — wires, recoveries, official sources. The richest planetary feed.", tier: "private" },
  { key: "local_events",        label: "Local Reality Events",     description: "Geo-localized events with severity, confidence, evidence chain", tier: "private" },
  { key: "early_warnings",      label: "Early Warnings",           description: "Active and resolved warning signals with escalation probability", tier: "private" },
  { key: "normalized_events",   label: "Normalized Events",        description: "Cross-provider canonical events (provenance preserved)", tier: "private" },
  { key: "geo_audit",           label: "Geo Resolution Audit",     description: "Per-signal geocoding attempts and unresolved-phrase reasons", tier: "training" },
  { key: "country_corrections", label: "Country Corrections",      description: "Mismatch detections rerouting signals to detected ISO3", tier: "training" },
  { key: "training_dataset",    label: "ML Training Dataset",      description: "Leakage-safe country-domain features with z-score labels", tier: "training" },
];

type ExportLog = {
  id: string;
  dataset_name: string;
  format: string;
  filters: Record<string, unknown>;
  row_count: number;
  file_size_bytes: number | null;
  sha256_checksum: string | null;
  storage_path: string | null;
  status: string;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
  exported_by_email: string | null;
};

function fmtBytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/1024/1024).toFixed(2)} MB`;
}

export default function ExportCenter() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dataset, setDataset] = useState<DatasetKey>("global_signals");
  const [format, setFormat] = useState<"csv"|"json"|"ndjson">("csv");
  const [iso3, setIso3] = useState("");
  const [eventType, setEventType] = useState("");
  const [warningKind, setWarningKind] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minConfidence, setMinConfidence] = useState<string>("");
  const [minSeverity, setMinSeverity] = useState<string>("");
  const [localityOnly, setLocalityOnly] = useState(false);
  const [gzipOn, setGzipOn] = useState(true);
  const [limit, setLimit] = useState(50_000);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const buildFilters = () => {
    const filters: Record<string, unknown> = {};
    if (iso3.trim()) filters.iso3 = iso3.trim().toUpperCase();
    if (eventType.trim()) filters.event_type = eventType.trim();
    if (warningKind.trim()) filters.warning_kind = warningKind.trim();
    if (search.trim()) filters.search = search.trim();
    if (dateFrom) filters.date_from = dateFrom;
    if (dateTo) filters.date_to = dateTo;
    if (minConfidence !== "") filters.min_confidence = Number(minConfidence);
    if (minSeverity !== "") filters.min_severity = Number(minSeverity);
    if (localityOnly) filters.locality_only = true;
    return filters;
  };

  const history = useQuery({
    queryKey: ["export-history"],
    queryFn: async (): Promise<ExportLog[]> => {
      const { data, error } = await supabase
        .from("aicis_export_logs")
        .select("id,dataset_name,format,filters,row_count,file_size_bytes,sha256_checksum,storage_path,status,error_message,duration_ms,created_at,exported_by_email")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ExportLog[];
    },
    staleTime: 30_000,
  });

  // supabase.functions.invoke() collapses any non-2xx into a generic
  // "non-2xx status code" message. Read the JSON body so the governed
  // reason (e.g. missing export role) reaches the operator.
  const invokeExport = async (body: Record<string, unknown>, fallback: string) => {
    const { data, error } = await supabase.functions.invoke("export-aicis-dataset", { body });
    if (error) {
      let detail = error.message;
      const res = (error as { context?: Response }).context;
      if (res && typeof res.text === "function") {
        try {
          const parsed = JSON.parse(await res.clone().text());
          if (parsed?.error) detail = String(parsed.error);
        } catch {
          /* keep transport-level message */
        }
      }
      throw new Error(detail);
    }
    if (!data?.ok) throw new Error(data?.error || fallback);
    return data;
  };

  const previewMut = useMutation({
    mutationFn: () =>
      invokeExport(
        { action: "preview", dataset_name: dataset, filters: buildFilters() },
        "Preview failed",
      ),
    onSuccess: (d) => {
      setPreviewCount(d.estimated_row_count);
      toast({
        title: "Preview",
        description: `${d.estimated_row_count.toLocaleString()} matching rows · cap ${d.hard_cap.toLocaleString()}`,
      });
    },
    onError: (e: Error) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const exportMut = useMutation({
    mutationFn: () =>
      invokeExport(
        { action: "export", dataset_name: dataset, format, filters: buildFilters(), limit, gzip: gzipOn },
        "Export failed",
      ),

    onSuccess: (data) => {
      const ratio = data.compression_ratio && data.compression_ratio > 1
        ? ` · gzip ${data.compression_ratio}×` : "";
      toast({
        title: "Export ready",
        description: `${data.row_count.toLocaleString()} rows · ${fmtBytes(data.file_size_bytes)}${ratio} · sha256 ${data.sha256_checksum.slice(0,12)}…`,
      });
      if (data.signed_url) window.open(data.signed_url, "_blank", "noopener,noreferrer");
      qc.invalidateQueries({ queryKey: ["export-history"] });
    },
    onError: (e: Error) => toast({ title: "Export failed", description: e.message, variant: "destructive" }),
  });

  const tierColor = (t: string) =>
    t === "public" ? "bg-emerald-500/15 text-emerald-300 border-emerald-700/50"
    : t === "training" ? "bg-amber-500/15 text-amber-300 border-amber-700/50"
    : "bg-sky-500/15 text-sky-300 border-sky-700/50";

  const datasetMeta = DATASETS.find(d => d.key === dataset)!;
  const overCap = previewCount !== null && previewCount > limit;

  // KPI rollup from recent exports
  const logs = history.data ?? [];
  const successLogs = logs.filter(l => l.status === "success");
  const totalRows = successLogs.reduce((s, l) => s + (l.row_count || 0), 0);
  const totalBytes = successLogs.reduce((s, l) => s + (l.file_size_bytes || 0), 0);
  const successRate = logs.length ? Math.round((successLogs.length / logs.length) * 100) : 0;
  const lastExport = logs[0] ? new Date(logs[0].created_at) : null;

  return (
    <AICISLayout>
      <div className="overflow-y-auto h-full">
        <div className="container mx-auto py-6 max-w-[1400px] space-y-5 px-4 md:px-6 lg:px-8 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileDown className="h-5 w-5 text-primary" /> Data Export
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Permissioned, logged, provenance-safe data exports. Every download is identity-bound and SHA-256 verified.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-400 border border-emerald-700/40 bg-emerald-500/5 rounded px-2 py-1">
          <ShieldCheck className="h-3 w-3" />
          No PII · SHA-256 · Keyset-stable
        </span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Exports (20 latest)</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1">{logs.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Success rate</div>
          <div className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
            successRate >= 95 ? "text-emerald-400" : successRate >= 80 ? "text-amber-500" : "text-destructive"
          }`}>{logs.length ? `${successRate}%` : "—"}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Rows delivered</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1 text-primary">{totalRows.toLocaleString()}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Bytes shipped</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1">{fmtBytes(totalBytes)}</div>
          {lastExport && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              last {formatDistanceToNow(lastExport, { addSuffix: true })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Build export</CardTitle>
            <CardDescription>Choose dataset, format, and apply filters. Hard cap 250,000 rows. Always preview first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label className="mb-2 block">Dataset</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {DATASETS.map(d => (
                  <button
                    key={d.key}
                    onClick={() => { setDataset(d.key); setPreviewCount(null); }}
                    className={`text-left rounded-md border p-3 transition-colors min-h-[44px] ${
                      dataset === d.key ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{d.label}</span>
                      <Badge variant="outline" className={tierColor(d.tier)}>{d.tier}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{d.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="format">Format</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as any)}>
                  <SelectTrigger id="format"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV</SelectItem>
                    <SelectItem value="json">JSON (single object)</SelectItem>
                    <SelectItem value="ndjson">NDJSON (line-delimited)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="limit">Row limit</Label>
                <Input id="limit" type="number" min={1} max={250_000} value={limit}
                  onChange={(e) => setLimit(Math.max(1, Math.min(250_000, Number(e.target.value)||0)))} />
              </div>
              <div>
                <Label htmlFor="iso3">Country (ISO3)</Label>
                <Input id="iso3" maxLength={3} placeholder="e.g. LBR, KEN" value={iso3}
                  onChange={(e) => setIso3(e.target.value.toUpperCase())} />
              </div>

              <div>
                <Label htmlFor="from">Date from</Label>
                <Input id="from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="to">Date to</Label>
                <Input id="to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="etype">Event type / category</Label>
                <Input id="etype" placeholder="flood, conflict, geopolitical…" value={eventType}
                  onChange={(e) => setEventType(e.target.value)} />
              </div>

              <div className="md:col-span-3">
                <Label htmlFor="search">Free-text search (title / summary)</Label>
                <Input id="search" placeholder='e.g. "noise pollution Liberia"' value={search}
                  onChange={(e) => setSearch(e.target.value)} />
              </div>

              <div>
                <Label htmlFor="wkind">Warning kind</Label>
                <Input id="wkind" placeholder="rising_cluster…" value={warningKind}
                  onChange={(e) => setWarningKind(e.target.value)}
                  disabled={dataset !== "early_warnings"} />
              </div>
              <div>
                <Label htmlFor="conf">Min confidence (0–1)</Label>
                <Input id="conf" type="number" step="0.05" min={0} max={1} value={minConfidence}
                  onChange={(e) => setMinConfidence(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="sev">Min severity / impact (0–1)</Label>
                <Input id="sev" type="number" step="0.05" min={0} max={1} value={minSeverity}
                  onChange={(e) => setMinSeverity(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center gap-6 pt-1 flex-wrap">
              <div className="flex items-center gap-3">
                <Switch id="loc" checked={localityOnly} onCheckedChange={setLocalityOnly} />
                <Label htmlFor="loc" className="cursor-pointer">Only rows with a resolved locality</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="gz" checked={gzipOn} onCheckedChange={setGzipOn} />
                <Label htmlFor="gz" className="cursor-pointer flex items-center gap-1">
                  <Archive className="h-4 w-4" /> gzip compress (typically 5–15× smaller)
                </Label>
              </div>
            </div>

            {previewCount !== null && (
              <div className={`rounded-md border p-3 text-xs ${
                overCap
                  ? "border-amber-700/50 bg-amber-500/10 text-amber-200"
                  : "border-emerald-700/50 bg-emerald-500/10 text-emerald-200"
              }`}>
                Preview matched <strong>{previewCount.toLocaleString()}</strong> rows.
                {overCap && (
                  <> Your row limit is <strong>{limit.toLocaleString()}</strong> — only the most recent {limit.toLocaleString()} will be exported. Raise limit or tighten filters.</>
                )}
              </div>
            )}

            <div className="rounded-md border border-amber-700/40 bg-amber-500/5 p-3 text-xs text-amber-200/90 flex items-start gap-2">
              <Lock className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <strong>{datasetMeta.label}</strong> is a <em>{datasetMeta.tier}</em> dataset. Every export is
                logged with your identity, filters, row count, and SHA-256 checksum.
                Source provenance fields are preserved. Raw secrets and PII are never exported.
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => previewMut.mutate()}
                disabled={previewMut.isPending}
                variant="outline"
                className="min-h-[44px]"
              >
                {previewMut.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Counting…</>
                  : <><Eye className="h-4 w-4 mr-2" /> Preview row count</>}
              </Button>
              <Button
                onClick={() => exportMut.mutate()}
                disabled={exportMut.isPending}
                className="min-h-[44px]"
                size="lg"
              >
                {exportMut.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
                  : <><Download className="h-4 w-4 mr-2" /> Generate export</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="h-5 w-5" /> Recent exports
            </CardTitle>
            <CardDescription>Last 20 attempts (audit-grade)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {history.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {history.data && history.data.length === 0 && (
              <p className="text-sm text-muted-foreground">No exports yet — generate the first one.</p>
            )}
            {history.data?.map(log => (
              <div key={log.id} className="rounded-md border border-border p-3 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{log.dataset_name}</span>
                  <Badge variant={log.status === "success" ? "default" : log.status === "error" ? "destructive" : "secondary"}>
                    {log.status}
                  </Badge>
                </div>
                <div className="text-muted-foreground">
                  {log.format.toUpperCase()} · {log.row_count.toLocaleString()} rows
                  {log.file_size_bytes ? ` · ${fmtBytes(log.file_size_bytes)}` : ""}
                  {log.duration_ms ? ` · ${log.duration_ms}ms` : ""}
                </div>
                {log.sha256_checksum && (
                  <div className="font-mono text-[10px] text-muted-foreground/80 truncate">
                    sha256:{log.sha256_checksum}
                  </div>
                )}
                {log.error_message && (
                  <div className="text-destructive text-[11px]">{log.error_message}</div>
                )}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-muted-foreground">
                    {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                  </span>
                  {log.storage_path && log.status === "success" && (
                    <ResignButton path={log.storage_path} />
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
        </div>
      </div>
    </AICISLayout>
  );
}

function ResignButton({ path }: { path: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="ghost" size="sm" className="h-7 px-2 text-xs"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        const { data, error } = await supabase.storage
          .from("aicis-exports").createSignedUrl(path, 600);
        setLoading(false);
        if (error || !data?.signedUrl) {
          toast({ title: "Re-sign failed", description: error?.message ?? "no url", variant: "destructive" });
          return;
        }
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      }}
    >
      <ExternalLink className="h-3 w-3 mr-1" /> Download
    </Button>
  );
}
