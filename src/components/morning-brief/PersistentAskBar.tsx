import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";

interface PersistentAskBarProps {
  className?: string;
}

interface SpeechRecognitionResultEventLike {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  start: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export const PersistentAskBar = ({ className }: PersistentAskBarProps) => {
  const navigate = useNavigate();
  const { selectedEntity } = useIntelligenceOS();
  const [query, setQuery] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    (text: string) => {
      const question = text.trim();
      if (!question) return;

      setSubmitting(true);

      const params = new URLSearchParams({ question });
      if (selectedEntity) {
        params.set("entity", [selectedEntity.type, selectedEntity.id].join(":"));
      }

      navigate(`/intelligence-engine?${params.toString()}`);
      window.setTimeout(() => setSubmitting(false), 400);
    },
    [navigate, selectedEntity],
  );

  const handleVoice = () => {
    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition =
      speechWindow.webkitSpeechRecognition || speechWindow.SpeechRecognition;

    if (!Recognition) {
      toast.error("Voice input isn't supported in this browser");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => {
      setIsListening(false);
      toast.error("Couldn't hear you — try again");
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      setQuery(transcript);
      submit(transcript);
    };
    recognition.start();
  };

  return (
    <div
      className={cn(
        "sticky top-0 z-30 -mx-3 px-3 py-1.5 sm:-mx-4 sm:px-4",
        "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        "border-b border-border/50",
        className,
      )}
      data-tour="ask-bar"
    >
      <div className="relative">
        <Sparkles className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-primary" />

        <Input
          type="text"
          inputMode="search"
          placeholder={
            selectedEntity
              ? `Ask AICIS about ${selectedEntity.name}…`
              : "Ask AICIS — e.g. 'what changed in West Africa?'"
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit(query)}
          className="h-8 border-border bg-muted/40 pl-8 pr-20 text-xs placeholder:text-muted-foreground/70 focus:border-primary sm:text-sm"
          aria-label="Ask AICIS a question"
        />

        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6",
              isListening && "animate-pulse bg-destructive/15 text-destructive",
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
            className="h-6 gap-1 px-2 text-[11px]"
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
