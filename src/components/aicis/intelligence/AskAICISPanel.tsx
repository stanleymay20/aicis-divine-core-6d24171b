import { FormEvent, useState } from "react";
import { BrainCircuit, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";

export const AskAICISPanel = () => {
  const navigate = useNavigate();
  const { selectedEntity } = useIntelligenceOS();
  const [question, setQuestion] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;

    const params = new URLSearchParams();
    params.set("question", trimmed);
    if (selectedEntity) {
      params.set("entity", [selectedEntity.type, selectedEntity.id].join(":"));
    }

    navigate("/intelligence-engine?" + params.toString());
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <BrainCircuit className="h-4 w-4 text-primary" />
          Contextual Ask AICIS
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {selectedEntity
            ? "The selected " + selectedEntity.type + " is carried into the research workspace."
            : "Ask from the current workspace or select an entity first for stronger context."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={selectedEntity ? "Ask about " + selectedEntity.name + "…" : "Ask AICIS…"}
          aria-label="Ask AICIS"
        />
        <Button type="submit" className="w-full gap-2" disabled={!question.trim()}>
          Open in full research
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
};
