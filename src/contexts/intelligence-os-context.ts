import { createContext } from "react";
import type { AICISEntity, InspectorTab } from "@/types/intelligence-os";

export interface IntelligenceOSContextValue {
  selectedEntity: AICISEntity | null;
  isInspectorOpen: boolean;
  activeInspectorTab: InspectorTab;
  isCommandPaletteOpen: boolean;
  selectEntity: (entity: AICISEntity) => void;
  clearEntity: () => void;
  openInspector: (tab?: InspectorTab) => void;
  closeInspector: () => void;
  setInspectorTab: (tab: InspectorTab) => void;
  openAsk: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const IntelligenceOSContext = createContext<IntelligenceOSContextValue | null>(null);
