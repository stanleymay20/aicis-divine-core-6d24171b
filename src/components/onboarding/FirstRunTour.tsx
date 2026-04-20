import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Eye, Zap, CheckCircle2, ArrowRight } from "lucide-react";

const STORAGE_KEY = "aicis.firstRunTour.v1";

const STEPS = [
  {
    icon: Sparkles,
    title: "Ask anything, in plain English",
    body: "Type or say a question at the top of the page — like 'What's my biggest risk this week?'. No menus to learn.",
  },
  {
    icon: Eye,
    title: "Read your morning brief",
    body: "Below the ask bar, you'll see what's changed, what's urgent, and what's exposed — in plain language with no acronyms.",
  },
  {
    icon: Zap,
    title: "Act, then close the loop",
    body: "Each priority comes with a recommended action. Mark it done when you've acted, and the system learns from the outcome.",
  },
];

export const FirstRunTour = () => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) {
      // Slight delay so the dashboard renders behind the dialog
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setOpen(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else dismiss();
  };

  const Icon = STEPS[step].icon;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && dismiss()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-lg">
            {STEPS[step].title}
          </DialogTitle>
          <DialogDescription className="text-center text-sm leading-relaxed">
            {STEPS[step].body}
          </DialogDescription>
        </DialogHeader>

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 mt-1">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-primary" : "w-1.5 bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Skip
          </Button>
          <Button size="sm" onClick={next} className="gap-1.5">
            {isLast ? (
              <>
                <CheckCircle2 className="h-4 w-4" /> Got it
              </>
            ) : (
              <>
                Next <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
