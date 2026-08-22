import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AICISTopBar } from "./AICISTopBar";
import {
  AICISSidebar,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
} from "./AICISSidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { TrustFooter } from "@/components/sovereign/TrustFooter";

const SIDEBAR_STATE_KEY = "aicis:sidebar-collapsed";

interface AICISLayoutProps {
  children: React.ReactNode;
}

export const AICISLayout = ({ children }: AICISLayoutProps) => {
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    if (stored !== null) return stored === "1";
    return window.innerWidth < 1280;
  });
  const [activeSection, setActiveSection] = useState("overview");
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname.split("/")[1] || "overview";
    setActiveSection(path);
  }, [location]);

  useEffect(() => {
    if (isMobile) return;
    try {
      window.localStorage.setItem(SIDEBAR_STATE_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      // Storage may be disabled in hardened/private browsing contexts.
    }
  }, [sidebarCollapsed, isMobile]);

  useEffect(() => {
    const handler = () => setSidebarCollapsed((collapsed) => !collapsed);
    document.addEventListener("toggle-sidebar", handler);
    return () => document.removeEventListener("toggle-sidebar", handler);
  }, []);

  const desktopMargin = sidebarCollapsed
    ? SIDEBAR_WIDTH_COLLAPSED
    : SIDEBAR_WIDTH_EXPANDED;

  return (
    <div className="h-screen w-full overflow-hidden bg-background flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Skip to planetary workspace
      </a>

      <AICISTopBar />

      <div className="flex-1 flex overflow-hidden">
        <AICISSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />

        <main
          id="main-content"
          role="main"
          style={!isMobile ? { marginLeft: desktopMargin } : undefined}
          className={cn(
            "relative flex-1 overflow-y-auto overflow-x-hidden flex flex-col",
            "transition-[margin] duration-200",
            "bg-[radial-gradient(circle_at_12%_0%,hsl(var(--primary)/0.08),transparent_32%),radial-gradient(circle_at_90%_12%,hsl(var(--secondary)/0.05),transparent_30%)]",
          )}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(hsl(var(--border))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px)] [background-size:48px_48px]"
          />
          <div className="relative flex-1">{children}</div>
          <div className="relative">
            <TrustFooter />
          </div>
        </main>
      </div>
    </div>
  );
};
