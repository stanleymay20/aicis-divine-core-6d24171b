import { useContext } from "react";
import { IntelligenceOSContext } from "@/contexts/intelligence-os-context";

export const useIntelligenceOS = () => {
  const context = useContext(IntelligenceOSContext);
  if (!context) {
    throw new Error("useIntelligenceOS must be used inside IntelligenceOSProvider");
  }
  return context;
};
