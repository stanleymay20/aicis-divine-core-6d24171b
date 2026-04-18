import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

interface DemoModeContextValue {
  isDemo: boolean;
  enableDemo: () => void;
  disableDemo: () => void;
}

const DemoModeContext = createContext<DemoModeContextValue>({
  isDemo: false,
  enableDemo: () => {},
  disableDemo: () => {},
});

const DEMO_KEY = "aicis_demo_mode";

export const DemoModeProvider = ({ children }: { children: ReactNode }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isDemo, setIsDemo] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(DEMO_KEY) === "1";
  });

  // Sync with ?demo=true URL param
  useEffect(() => {
    const param = searchParams.get("demo");
    if (param === "true" && !isDemo) {
      sessionStorage.setItem(DEMO_KEY, "1");
      setIsDemo(true);
    }
    if (param === "false" && isDemo) {
      sessionStorage.removeItem(DEMO_KEY);
      setIsDemo(false);
    }
  }, [searchParams, isDemo]);

  const enableDemo = () => {
    sessionStorage.setItem(DEMO_KEY, "1");
    setIsDemo(true);
  };

  const disableDemo = () => {
    sessionStorage.removeItem(DEMO_KEY);
    setIsDemo(false);
    // Strip ?demo from URL
    const next = new URLSearchParams(searchParams);
    next.delete("demo");
    setSearchParams(next, { replace: true });
  };

  return (
    <DemoModeContext.Provider value={{ isDemo, enableDemo, disableDemo }}>
      {children}
    </DemoModeContext.Provider>
  );
};

export const useDemoMode = () => useContext(DemoModeContext);
