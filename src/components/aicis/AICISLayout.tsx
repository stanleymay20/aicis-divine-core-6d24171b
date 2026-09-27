import { AICISAppShell } from "@/components/aicis/shell/AICISAppShell";
import { IntelligenceOSProvider } from "@/contexts/IntelligenceOSContext";

interface AICISLayoutProps {
  children: React.ReactNode;
}

export const AICISLayout = ({ children }: AICISLayoutProps) => (
  <IntelligenceOSProvider>
    <AICISAppShell>{children}</AICISAppShell>
  </IntelligenceOSProvider>
);
