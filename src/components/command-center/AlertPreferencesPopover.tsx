import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SlidersHorizontal, X, Plus } from "lucide-react";
import {
  AlertPreferences,
  Severity,
  summarizePreferences,
} from "@/hooks/useAlertPreferences";
import { cn } from "@/lib/utils";

interface Props {
  prefs: AlertPreferences;
  onChange: (next: AlertPreferences) => void;
  availableDivisions: string[];
  availableCountries: string[];
}

const SEVERITY_OPTIONS: { value: Severity; label: string; tone: string }[] = [
  { value: "low",      label: "Everything",  tone: "bg-muted text-muted-foreground" },
  { value: "medium",   label: "Medium+",     tone: "bg-primary/15 text-primary" },
  { value: "high",     label: "High+",       tone: "bg-warning/20 text-warning-foreground" },
  { value: "critical", label: "Critical only", tone: "bg-destructive/20 text-destructive" },
];

export const AlertPreferencesPopover = ({
  prefs,
  onChange,
  availableDivisions,
  availableCountries,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [keywordDraft, setKeywordDraft] = useState("");

  const toggleListItem = (
    key: "divisions" | "countries",
    value: string
  ) => {
    const list = prefs[key];
    const next = list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
    onChange({ ...prefs, [key]: next });
  };

  const addKeyword = () => {
    const k = keywordDraft.trim();
    if (!k || prefs.mute_keywords.includes(k)) return;
    onChange({ ...prefs, mute_keywords: [...prefs.mute_keywords, k] });
    setKeywordDraft("");
  };

  const removeKeyword = (k: string) =>
    onChange({
      ...prefs,
      mute_keywords: prefs.mute_keywords.filter((x) => x !== k),
    });

  const reset = () =>
    onChange({
      min_severity: "low",
      divisions: [],
      countries: [],
      mute_keywords: [],
      show_acknowledged: true,
    });

  const isCustomized =
    prefs.min_severity !== "low" ||
    prefs.divisions.length > 0 ||
    prefs.countries.length > 0 ||
    prefs.mute_keywords.length > 0 ||
    !prefs.show_acknowledged;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={isCustomized ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1.5"
        >
          <SlidersHorizontal className="h-3 w-3" />
          Filters
          {isCustomized && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              On
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[340px] p-0" align="end">
        <div className="px-4 py-3 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Alert preferences</h3>
            {isCustomized && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground"
                onClick={reset}
              >
                Reset
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {summarizePreferences(prefs)}
          </p>
        </div>

        <ScrollArea className="max-h-[60vh]">
          <div className="p-4 space-y-5">
            {/* Severity */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Show me alerts that are…</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {SEVERITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() =>
                      onChange({ ...prefs, min_severity: opt.value })
                    }
                    className={cn(
                      "px-2.5 py-2 rounded-md text-xs font-medium border transition-all text-left",
                      prefs.min_severity === opt.value
                        ? "border-primary ring-1 ring-primary " + opt.tone
                        : "border-border hover:border-primary/40 text-muted-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Divisions */}
            {availableDivisions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Topics</Label>
                  {prefs.divisions.length > 0 && (
                    <button
                      onClick={() => onChange({ ...prefs, divisions: [] })}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Clear ({prefs.divisions.length})
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground -mt-1">
                  Empty = show every topic
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {availableDivisions.map((d) => {
                    const active = prefs.divisions.includes(d);
                    return (
                      <button
                        key={d}
                        onClick={() => toggleListItem("divisions", d)}
                        className={cn(
                          "px-2 py-1 rounded-full text-[11px] border transition-all capitalize",
                          active
                            ? "bg-primary/15 border-primary text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40"
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Countries */}
            {availableCountries.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Countries</Label>
                  {prefs.countries.length > 0 && (
                    <button
                      onClick={() => onChange({ ...prefs, countries: [] })}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Clear ({prefs.countries.length})
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {availableCountries.slice(0, 60).map((c) => {
                    const active = prefs.countries.includes(c);
                    return (
                      <button
                        key={c}
                        onClick={() => toggleListItem("countries", c)}
                        className={cn(
                          "px-2 py-1 rounded-full text-[11px] border transition-all",
                          active
                            ? "bg-primary/15 border-primary text-primary"
                            : "border-border text-muted-foreground hover:border-primary/40"
                        )}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Separator />

            {/* Keyword mute list */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Mute keywords</Label>
              <div className="flex gap-1.5">
                <Input
                  value={keywordDraft}
                  onChange={(e) => setKeywordDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
                  placeholder="e.g. drill, test"
                  className="h-7 text-xs"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7 shrink-0"
                  onClick={addKeyword}
                  disabled={!keywordDraft.trim()}
                  aria-label="Add keyword"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {prefs.mute_keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {prefs.mute_keywords.map((k) => (
                    <Badge
                      key={k}
                      variant="secondary"
                      className="text-[10px] gap-1 pr-1"
                    >
                      {k}
                      <button
                        onClick={() => removeKeyword(k)}
                        className="hover:text-destructive"
                        aria-label={`Remove ${k}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Show acknowledged */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-medium">Show acknowledged</Label>
                <p className="text-[10px] text-muted-foreground">
                  Include alerts you've already read
                </p>
              </div>
              <Switch
                checked={prefs.show_acknowledged}
                onCheckedChange={(v) =>
                  onChange({ ...prefs, show_acknowledged: v })
                }
              />
            </div>
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
