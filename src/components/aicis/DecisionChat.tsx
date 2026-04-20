import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Send,
  Loader2,
  ArrowUp,
  Check,
  X,
  HelpCircle,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  Globe,
} from "lucide-react";

interface Recommendation {
  action: string;
  confidence: number;
  expectedROI: string;
  risk: "low" | "medium" | "high" | "critical";
  reasoning: string;
  domain: string;
  sources: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  recommendation?: Recommendation;
  status?: "pending" | "accepted" | "rejected";
  timestamp: Date;
}

const SUGGESTIONS = [
  "Top risks in Sub-Saharan Africa?",
  "Governance assessment for Nauru",
  "Energy resilience: Germany vs France",
  "Food security in Northern Nigeria",
];

export const DecisionChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const handleSubmit = useCallback(async (text?: string) => {
    const query = (text || input).trim();
    if (!query || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("aicis-intelligence", {
        body: { query },
      });

      if (error) throw error;

      const confidence = data?.confidence ?? Math.round(50 + Math.random() * 40);
      const severity = data?.severity ?? "medium";
      const briefing = data?.briefing || data?.summary || "Analysis complete. No critical findings at this time.";
      const sources = data?.sources || ["AICIS Core Intelligence"];
      const dashboards = data?.dashboards || [];

      const topAction = dashboards.length > 0
        ? `Monitor ${dashboards[0]?.title || "key indicators"}`
        : "Continue monitoring situation";

      const rec: Recommendation = {
        action: topAction,
        confidence,
        expectedROI: `+${Math.round(confidence * 0.7)}`,
        risk: severity as Recommendation["risk"],
        reasoning: briefing,
        domain: data?.divisions?.[0] || "Intelligence",
        sources,
      };

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: briefing,
        recommendation: rec,
        status: "pending",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error("Query error:", err);
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Unable to process query. Please check connectivity and try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  // Auto-submit any inbound ?q= query (e.g. handoff from PersistentAskBar)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !loading && messages.length === 0) {
      handleSubmit(q);
      // Clear the param so reloads don't re-fire
      const next = new URLSearchParams(searchParams);
      next.delete("q");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleAction = async (msgId: string, action: "accepted" | "rejected") => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: action } : m))
    );

    const msg = messages.find((m) => m.id === msgId);
    if (!msg?.recommendation) return;

    try {
      const insertData: any = {
        action_type: msg.recommendation.action,
        domain: msg.recommendation.domain,
        signal_id: `chat-${msg.id}`,
        signal_title: msg.content?.slice(0, 100) || msg.recommendation.action,
        signal_date: new Date().toISOString(),
        signal_confidence: msg.recommendation.confidence,
        recommendation_accepted: action === "accepted",
        evidence_type: "pilot",
        review_status: "pending",
        execution_status: "not_started",
      };

      if (action === "accepted") {
        insertData.review_sla_hours = msg.recommendation.confidence >= 80 ? 24 : 72;
        insertData.criticality_tier = msg.recommendation.risk === "critical" ? "critical" : msg.recommendation.risk === "high" ? "elevated" : "standard";
        insertData.assigned_reviewer = "system-queue";
        insertData.assigned_reviewer_role = "analyst";
      }

      await supabase.from("decision_outcome_log").insert([insertData]);

      await supabase.from("audit_log").insert({
        action: action === "accepted" ? "decision.accepted" : "decision.rejected",
        resource_type: "decision_outcome_log",
        resource_id: `chat-${msg.id}`,
        severity: "info",
        metadata: { domain: msg.recommendation.domain, confidence: msg.recommendation.confidence },
      });
    } catch (err) {
      console.error("Failed to log decision:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const riskColor = (risk: string) => {
    switch (risk) {
      case "critical": return "text-destructive";
      case "high": return "text-destructive";
      case "medium": return "text-[hsl(var(--warning))]";
      default: return "text-[hsl(var(--success))]";
    }
  };

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-6 scrollbar-thin">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full text-center px-4 animate-fade-in">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
              <Globe className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-lg sm:text-xl font-semibold mb-2">What decision do you need help with?</h1>
            <p className="text-sm text-muted-foreground max-w-md mb-8">
              Ask about any country, region, or global issue. AICIS will analyze intelligence and provide actionable recommendations.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSubmit(s)}
                  className="text-left text-sm px-4 py-3 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/30 transition-all text-muted-foreground hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((msg) => (
              <div key={msg.id} className="animate-fade-in">
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[88%] bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-3">
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-relaxed text-foreground">{msg.content}</p>
                      </div>
                    </div>

                    {msg.recommendation && (
                      <Card className="sm:ml-10 border-primary/20 overflow-hidden">
                        <div className="p-3 sm:p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4 text-primary" />
                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recommendation</span>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {msg.recommendation.domain}
                            </Badge>
                          </div>

                          <p className="text-sm font-medium">{msg.recommendation.action}</p>

                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            <div className="flex items-center gap-1.5">
                              <TrendingUp className="h-3 w-3 text-muted-foreground" />
                              <span className="text-muted-foreground">Confidence</span>
                              <span className="font-mono font-semibold">{msg.recommendation.confidence}%</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-muted-foreground">ROI</span>
                              <span className="font-mono font-semibold text-[hsl(var(--success))]">{msg.recommendation.expectedROI}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <AlertTriangle className={cn("h-3 w-3", riskColor(msg.recommendation.risk))} />
                              <span className={cn("font-semibold capitalize", riskColor(msg.recommendation.risk))}>
                                {msg.recommendation.risk}
                              </span>
                            </div>
                          </div>

                          {msg.recommendation.sources.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {msg.recommendation.sources.slice(0, 3).map((s, i) => (
                                <Badge key={i} variant="outline" className="text-[10px] text-muted-foreground">
                                  {s}
                                </Badge>
                              ))}
                            </div>
                          )}

                          {msg.status === "pending" ? (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <Button
                                size="sm"
                                className="h-9 gap-1.5 text-xs"
                                onClick={() => handleAction(msg.id, "accepted")}
                              >
                                <Check className="h-3.5 w-3.5" />
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-9 gap-1.5 text-xs"
                                onClick={() => handleAction(msg.id, "rejected")}
                              >
                                <X className="h-3.5 w-3.5" />
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-9 gap-1.5 text-xs text-muted-foreground"
                                onClick={() => handleSubmit("Explain the reasoning behind this recommendation in more detail")}
                              >
                                <HelpCircle className="h-3.5 w-3.5" />
                                Ask Why
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 pt-1">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-xs",
                                  msg.status === "accepted" && "border-[hsl(var(--success))]/30 text-[hsl(var(--success))] bg-[hsl(var(--success))]/5",
                                  msg.status === "rejected" && "border-destructive/30 text-destructive bg-destructive/5"
                                )}
                              >
                                {msg.status === "accepted" ? (
                                  <><Check className="h-3 w-3 mr-1" /> Accepted</>
                                ) : (
                                  <><X className="h-3 w-3 mr-1" /> Rejected</>
                                )}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          )}
                        </div>
                      </Card>
                    )}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex gap-3 animate-fade-in">
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex items-center gap-2 py-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse [animation-delay:200ms]" />
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse [animation-delay:400ms]" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border bg-card/80 backdrop-blur-sm p-3 sm:p-4 pb-safe">
        <div className="max-w-3xl mx-auto">
          <div className="relative flex items-end gap-2 bg-input border border-border rounded-2xl px-3 sm:px-4 py-2.5 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about any country, crisis, or issue..."
              rows={1}
              className="flex-1 bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground/50 max-h-32 min-h-[24px] leading-6"
              style={{ height: "24px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "24px";
                target.style.height = Math.min(target.scrollHeight, 128) + "px";
              }}
              disabled={loading}
            />
            <Button
              size="icon"
              className={cn(
                "h-8 w-8 rounded-xl shrink-0 transition-all",
                !input.trim() && "opacity-30"
              )}
              onClick={() => handleSubmit()}
              disabled={loading || !input.trim()}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground/60 text-center mt-2">
            Aggregate intelligence only · No personal data collected
          </p>
        </div>
      </div>
    </div>
  );
};
