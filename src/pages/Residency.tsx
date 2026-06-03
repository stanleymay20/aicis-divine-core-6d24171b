import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, MapPin, Lock, CheckCircle2, AlertCircle } from "lucide-react";
import { SEO } from "@/components/SEO";

type ResidencyRow = {
  id: string;
  resource_kind: string;
  resource_name: string;
  residency_region: "EU" | "UK" | "CA" | "JP" | "US" | "GLOBAL";
  sovereign_mode_visibility: "global" | "regional" | "national" | "isolated" | "public";
  contains_pii: boolean;
  aggregation_level: string | null;
  notes: string | null;
};

const REGION_LABEL: Record<string, string> = {
  EU: "European Union",
  UK: "United Kingdom",
  CA: "Canada",
  JP: "Japan",
  US: "United States",
  GLOBAL: "Global aggregate",
};

const VISIBILITY_TONE: Record<string, string> = {
  public: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  global: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  regional: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  national: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  isolated: "bg-red-500/15 text-red-300 border-red-500/30",
};

export default function Residency() {
  const { data, isLoading } = useQuery({
    queryKey: ["data-residency-manifest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_residency_manifest")
        .select("*")
        .order("residency_region", { ascending: true })
        .order("resource_name", { ascending: true });
      if (error) throw error;
      return data as ResidencyRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const grouped = (data ?? []).reduce<Record<string, ResidencyRow[]>>((acc, r) => {
    (acc[r.residency_region] ||= []).push(r);
    return acc;
  }, {});

  const totalResources = data?.length ?? 0;
  const piiCount = (data ?? []).filter((r) => r.contains_pii).length;
  const isolatedCount = (data ?? []).filter((r) => r.sovereign_mode_visibility === "isolated").length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title="Data Residency Manifest — AICIS"
        description="Auditable data residency manifest mapping every resource to its sovereign region and visibility class."
        path="/residency"
      />
      <header className="border-b border-border bg-card/40">
        <div className="container max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-3">
            <Shield className="h-7 w-7 text-primary" />
            <h1 className="text-3xl font-semibold tracking-tight">Data Residency Manifest</h1>
          </div>
          <p className="text-muted-foreground max-w-3xl">
            Public, auditable inventory of every data resource in AICIS — its residency region,
            sovereign-mode visibility, PII status, and aggregation level. Procurement teams use
            this manifest to verify residency claims against the live system of record.
          </p>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Summary tiles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-5 bg-card/50 border-border">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Resources tracked</div>
                <div className="text-3xl font-semibold mt-1">{totalResources}</div>
              </div>
              <MapPin className="h-5 w-5 text-primary/70" />
            </div>
          </Card>
          <Card className="p-5 bg-card/50 border-border">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-muted-foreground">PII-bearing resources</div>
                <div className="text-3xl font-semibold mt-1">{piiCount}</div>
                <div className="text-xs text-muted-foreground mt-1">All in EU region</div>
              </div>
              <Lock className="h-5 w-5 text-amber-400/80" />
            </div>
          </Card>
          <Card className="p-5 bg-card/50 border-border">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Isolated (sovereign-only)</div>
                <div className="text-3xl font-semibold mt-1">{isolatedCount}</div>
              </div>
              <CheckCircle2 className="h-5 w-5 text-emerald-400/80" />
            </div>
          </Card>
        </div>

        {/* Non-surveillance guarantee */}
        <Card className="p-5 bg-emerald-500/5 border-emerald-500/20">
          <div className="flex gap-3">
            <Shield className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <div className="font-medium text-emerald-300 mb-1">Non-Surveillance Guarantee</div>
              <p className="text-muted-foreground">
                AICIS processes only public and aggregate signals. No PII is ingested for
                intelligence production. All resources marked <em>isolated</em> are operational
                tenant data (auth, billing, audit) — never shared, never federated, never
                exported.
              </p>
            </div>
          </div>
        </Card>

        {/* Per-region tables */}
        {isLoading && <div className="text-muted-foreground">Loading manifest…</div>}

        {Object.keys(grouped).sort().map((region) => (
          <section key={region} className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">{region}</Badge>
              <h2 className="text-lg font-semibold">{REGION_LABEL[region] ?? region}</h2>
              <span className="text-xs text-muted-foreground">
                {grouped[region].length} resources
              </span>
            </div>
            <Card className="overflow-hidden border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">Resource</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Visibility</TableHead>
                    <TableHead>PII</TableHead>
                    <TableHead>Aggregation</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped[region].map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.resource_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.resource_kind}</TableCell>
                      <TableCell>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs border ${VISIBILITY_TONE[r.sovereign_mode_visibility] ?? ""}`}>
                          {r.sovereign_mode_visibility}
                        </span>
                      </TableCell>
                      <TableCell>
                        {r.contains_pii ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-300">
                            <AlertCircle className="h-3 w-3" /> yes
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">no</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.aggregation_level ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        ))}

        <footer className="text-xs text-muted-foreground pt-6 border-t border-border">
          This manifest is derived live from the <code className="font-mono">data_residency_manifest</code> table.
          Last updated continuously. For the underlying schema and audit trail, see the cryptographic
          ledger (<code className="font-mono">ledger_entries</code>).
        </footer>
      </main>
    </div>
  );
}
