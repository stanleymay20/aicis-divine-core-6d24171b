import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sparkles, Search, Mic, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const QUICK_ASKS = [
  "What needs my attention today?",
  "Show me top risks this week",
  "What changed overnight?",
  "Where am I most exposed?",
];

interface PersistentAskBarProps {
  className?: string;
}

/**
 * The "front door" for non-technical users. Always visible at the top
 * of the brief. Routes any natural-language question to the Decision
 * Chat / Risk Atlas, so users never have to learn the menu structure.
 */
export const PersistentAskBar = ({ className }: PersistentAskBarProps) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q) return;
      setSubmitting(true);
      // Route to the unified intelligence chat — single canonical entry point
      navigate(`/app?q=${encodeURIComponent(q)}`);
      // Soft reset for re-use
      setTimeout(() => setSubmitting(false), 400);
    },
    [navigate]
  );

  const handleVoice = () => {
    const SR =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;
    if (!SR) {
      toast.error("Voice input isn't supported in this browser");
      return;
    }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    r.continuous = false;
    r.onstart = () => setIsListening(true);
    r.onend = () => setIsListening(false);
    r.onerror = () => {
      setIsListening(false);
      toast.error("Couldn't hear you — try again");
    };
    r.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setQuery(text);
      submit(text);
    };
    r.start();
  };

  return (
    <div
      className={cn(
        "sticky top-0 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-1.5",
        "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        "border-b border-border/50",
        className
      )}
      data-tour="ask-bar"
    >
      <div className="relative">
        <Sparkles className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-primary pointer-events-none" />

        <Input
          type="text"
          inputMode="search"
          placeholder="Ask AICIS — e.g. 'biggest risk in Europe?'"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit(query)}
          className="h-8 pl-8 pr-20 text-xs sm:text-sm bg-muted/40 border-border focus:border-primary placeholder:text-muted-foreground/70"
          aria-label="Ask AICIS a question"
        />

        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6",
              isListening && "bg-destructive/15 text-destructive animate-pulse"
            )}
            onClick={handleVoice}
            aria-label="Ask by voice"
          >
            <Mic className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={() => submit(query)}
            disabled={submitting || !query.trim()}
            className="h-6 px-2 gap-1 text-[11px]"
          >
            {submitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            <span className="hidden sm:inline">Ask</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
