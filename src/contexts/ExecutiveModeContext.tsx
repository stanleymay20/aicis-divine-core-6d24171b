import { createContext, useContext, useEffect, useState } from "react";

export type ViewMode = "executive" | "analyst";

interface Ctx {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  toggle: () => void;
}

const ExecutiveModeContext = createContext<Ctx | undefined>(undefined);
const STORAGE_KEY = "aicis:view-mode";

export const ExecutiveModeProvider = ({ children }: { children: React.ReactNode }) => {
  const [mode, setModeState] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "executive";
    return (localStorage.getItem(STORAGE_KEY) as ViewMode) || "executive";
  });

  const setMode = (m: ViewMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  };

  useEffect(() => {
    document.documentElement.dataset.viewMode = mode;
  }, [mode]);

  return (
    <ExecutiveModeContext.Provider value={{ mode, setMode, toggle: () => setMode(mode === "executive" ? "analyst" : "executive") }}>
      {children}
    </ExecutiveModeContext.Provider>
  );
};

export const useViewMode = () => {
  const ctx = useContext(ExecutiveModeContext);
  if (!ctx) throw new Error("useViewMode must be used within ExecutiveModeProvider");
  return ctx;
};
