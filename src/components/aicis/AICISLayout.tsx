import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AICISTopBar } from "./AICISTopBar";
import { AICISSidebar, SIDEBAR_WIDTH_COLLAPSED, SIDEBAR_WIDTH_EXPANDED } from "./AICISSidebar";
import { useIsMobile } from "@/hooks/use-mobile";

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
    try { window.localStorage.setItem(SIDEBAR_STATE_KEY, sidebarCollapsed ? "1" : "0"); } catch {}
  }, [sidebarCollapsed, isMobile]);

  useEffect(() => {
    const handler = () => setSidebarCollapsed((c) => !c);
    document.addEventListener("toggle-sidebar", handler);
    return () => document.removeEventListener("toggle-sidebar", handler);
  }, []);

  const desktopMargin = sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  return (
    <div className="h-screen w-full overflow-hidden bg-background flex flex-col">
      <AICISTopBar />
      <div className="flex-1 flex overflow-hidden">
        <AICISSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        <main
          id="main-content"
          role="main"
          style={!isMobile ? { marginLeft: desktopMargin } : undefined}
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden flex flex-col transition-[margin] duration-200"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
};
