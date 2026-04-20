import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A floating, lightweight "Ask AICIS" pill for the Command Center.
 * Click → expands to an inline query input. Submitting routes to the
 * Decision Chat with the question pre-filled (handled by ?q= handoff).
 *
 * Designed for non-technical users who land on the dense map view and
 * want to ask a question instead of hunting through panels.
 */
export const AskAnythingPill = ({ className }: { className?: string }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const submit = () => {
    const text = q.trim();
    if (!text) return;
    navigate(`/app?q=${encodeURIComponent(text)}`);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "group flex items-center gap-2 h-10 pl-3 pr-4 rounded-full",
          "bg-card/95 backdrop-blur border border-primary/30 shadow-lg",
          "hover:border-primary hover:shadow-primary/20 transition-all",
          className
        )}
        aria-label="Ask a question"
      >
        <Sparkles className="h-4 w-4 text-primary group-hover:scale-110 transition-transform" />
        <span className="text-xs font-medium">Ask anything</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 h-11 pl-3 pr-1 rounded-full",
        "bg-card/95 backdrop-blur border border-primary shadow-xl",
        "min-w-[280px] sm:min-w-[360px]",
        className
      )}
    >
      <Sparkles className="h-4 w-4 text-primary shrink-0" />
      <Input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="What's my biggest risk in Europe?"
        className="h-8 border-0 bg-transparent focus-visible:ring-0 px-2 text-sm"
      />
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0"
        onClick={() => {
          setOpen(false);
          setQ("");
        }}
        aria-label="Close"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        className="h-8 w-8 shrink-0 rounded-full"
        onClick={submit}
        disabled={!q.trim()}
        aria-label="Ask"
      >
        <Search className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};
