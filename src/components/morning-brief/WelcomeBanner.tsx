import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Sunrise, Radio, MessageSquare, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

const DISMISSED_KEY = "aicis-welcome-dismissed";

export const WelcomeBanner = () => {
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (!dismissed) setVisible(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <Card className="border-primary/30 bg-primary/5 relative overflow-hidden">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={dismiss}
        aria-label="Dismiss welcome"
      >
        <X className="h-4 w-4" />
      </Button>
      <CardContent className="p-4 sm:p-5">
        <h2 className="text-base font-semibold mb-1">Welcome to AICIS 👋</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Your AI intelligence dashboard. Here's how to get started:
        </p>
        <div className="space-y-2.5">
          <QuickAction
            icon={<Sunrise className="h-4 w-4 text-primary" />}
            title="Today's Brief"
            desc="See the top risks and overnight changes"
            onClick={() => { dismiss(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            active
          />
          <QuickAction
            icon={<Radio className="h-4 w-4 text-primary" />}
            title="Live Signals"
            desc="Real-time intelligence from global sources"
            onClick={() => navigate("/live")}
          />
          <QuickAction
            icon={<MessageSquare className="h-4 w-4 text-primary" />}
            title="Ask AI"
            desc="Ask questions in plain English and get answers"
            onClick={() => navigate("/decisions")}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 text-xs text-muted-foreground"
          onClick={dismiss}
        >
          Don't show again
        </Button>
      </CardContent>
    </Card>
  );
};

const QuickAction = ({
  icon, title, desc, onClick, active,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  active?: boolean;
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors ${
      active
        ? "bg-primary/10 border border-primary/20"
        : "hover:bg-muted/50 border border-transparent"
    }`}
  >
    <div className="shrink-0">{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
    {!active && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
  </button>
);
