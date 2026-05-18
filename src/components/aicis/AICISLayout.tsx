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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [activeSection, setActiveSection] = useState("overview");
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname.split("/")[1] || "overview";
    setActiveSection(path);
  }, [location]);

  useEffect(() => {
    const handler = () => setSidebarCollapsed((c) => !c);
    document.addEventListener("toggle-sidebar", handler);
    return () => document.removeEventListener("toggle-sidebar", handler);
  }, []);

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
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden flex flex-col transition-all duration-200",
            isMobile ? "ml-0" : "ml-[52px]"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
};
