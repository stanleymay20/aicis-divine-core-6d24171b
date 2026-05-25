import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, Bookmark, Siren } from "lucide-react";
import { type Signal } from "./types";

export function StatTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className={`flex items-center gap-2 text-xs ${accent}`}>
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-2xl font-bold mt-1 font-mono">{value}</div>
      </CardContent>
    </Card>
  );
}

export function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs rounded-full border transition-colors min-h-[28px] ${
        active
          ? "bg-primary/15 border-primary text-primary"
          : "border-border text-muted-foreground hover:border-muted-foreground/50"
      }`}
    >
      {children}
    </button>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground/80 text-right">{value}</span>
    </div>
  );
}

export function FeedbackRow({ signal, disabled, onFeedback }: { signal: Signal; disabled: boolean; onFeedback: (type: string) => void }) {
  return (
    <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-2 flex-wrap text-[11px]">
      <span className="text-muted-foreground mr-1">Teach relevance:</span>
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => onFeedback("important") }>
        <ThumbsUp className="h-3 w-3 mr-1" /> Important
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => onFeedback("not_relevant") }>
        <ThumbsDown className="h-3 w-3 mr-1" /> Not relevant
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => onFeedback("save") }>
        <Bookmark className="h-3 w-3 mr-1" /> Save
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => onFeedback("escalate") }>
        <Siren className="h-3 w-3 mr-1" /> Escalate
      </Button>
      {!disabled && signal.relevance_is_fallback && <span className="text-amber-400">fallback score</span>}
    </div>
  );
}
