import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Settings, X, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useRelevancePreferences,
  type RelevancePreferences,
  EMPTY_PREFS,
} from "@/hooks/useRelevancePreferences";

const FIELDS: Array<{ key: keyof RelevancePreferences; label: string; placeholder: string }> = [
  { key: "countries", label: "Countries / Regions", placeholder: "e.g. France, Kenya" },
  { key: "operating_regions", label: "Operating Regions", placeholder: "e.g. EMEA, West Africa" },
  { key: "industries", label: "Industries", placeholder: "e.g. agriculture, fintech" },
  { key: "domains", label: "Domains", placeholder: "e.g. supply_chain, energy" },
  { key: "keywords", label: "Keywords", placeholder: "e.g. wheat, tariff, drought" },
  { key: "watched_entities", label: "Watched Entities", placeholder: "e.g. ECOWAS, Maersk" },
  { key: "risk_priorities", label: "Risk Priorities", placeholder: "e.g. price shock, sanction" },
  { key: "business_functions", label: "Business Functions", placeholder: "e.g. procurement, treasury" },
];

function ChipInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="text-[10px] gap-1 pr-1">
            {v}
            <button
              type="button"
              className="hover:text-destructive"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="h-7 text-xs"
        />
        <Button type="button" size="sm" variant="outline" className="h-7 px-2" onClick={add}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function RelevancePreferencesPanel({ compact = false }: { compact?: boolean }) {
  const { prefs, save, loaded, hasRow } = useRelevancePreferences();
  const [draft, setDraft] = useState<RelevancePreferences>(EMPTY_PREFS);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (loaded) setDraft(prefs);
  }, [loaded, prefs]);

  const setField = <K extends keyof RelevancePreferences>(k: K, v: RelevancePreferences[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const onSave = async () => {
    setSaving(true);
    const { error } = await save(draft);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Preferences saved", description: "Relevance scoring will use your context." });
    }
  };

  if (!loaded) {
    return (
      <Card className="p-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading preferences…
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Relevance Preferences</h3>
          {!hasRow && (
            <Badge variant="outline" className="text-[9px]">Not configured</Badge>
          )}
        </div>
        <Button size="sm" onClick={onSave} disabled={saving} className="gap-1 h-7">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        These signals are used to personalize how AICIS scores incoming events. Add anything that
        affects your operations.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-[11px]">Organization Name</Label>
          <Input
            value={draft.organization_name || ""}
            onChange={(e) => setField("organization_name", e.target.value)}
            placeholder="e.g. Acme Logistics"
            className="h-7 text-xs"
          />
        </div>
        {FIELDS.map((f) => (
          <div key={f.key} className={compact ? "" : ""}>
            <Label className="text-[11px]">{f.label}</Label>
            <ChipInput
              values={(draft[f.key] as string[]) || []}
              onChange={(next) => setField(f.key, next as any)}
              placeholder={f.placeholder}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
