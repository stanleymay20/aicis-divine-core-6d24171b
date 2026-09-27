import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import type { AICISEntity, AICISEntityType, InspectorTab } from "@/types/intelligence-os";

const ENTITY_PARAM = "entity";

interface IntelligenceOSContextValue {
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

const IntelligenceOSContext = createContext<IntelligenceOSContextValue | null>(null);

const serializeEntity = (entity: AICISEntity) => [entity.type, entity.id].join(":");

const parseEntity = (value: string | null): AICISEntity | null => {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;

  const type = value.slice(0, separator) as AICISEntityType;
  const id = value.slice(separator + 1);

  return {
    id,
    type,
    name: id.toUpperCase(),
  };
};

export const IntelligenceOSProvider = ({ children }: { children: ReactNode }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const entityParam = searchParams.get(ENTITY_PARAM);
  const [entityCache, setEntityCache] = useState<Record<string, AICISEntity>>({});
  const [isInspectorOpen, setInspectorOpen] = useState(Boolean(entityParam));
  const [activeInspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const selectedEntity = useMemo(() => {
    if (!entityParam) return null;
    return entityCache[entityParam] ?? parseEntity(entityParam);
  }, [entityCache, entityParam]);

  useEffect(() => {
    if (entityParam) setInspectorOpen(true);
  }, [entityParam]);

  const selectEntity = useCallback(
    (entity: AICISEntity) => {
      const key = serializeEntity(entity);
      setEntityCache((current) => ({ ...current, [key]: entity }));

      const next = new URLSearchParams(searchParams);
      next.set(ENTITY_PARAM, key);
      setSearchParams(next, { replace: true });

      setInspectorTab("overview");
      setInspectorOpen(true);
    },
    [searchParams, setSearchParams],
  );

  const clearEntity = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete(ENTITY_PARAM);
    setSearchParams(next, { replace: true });
    setInspectorTab("overview");
    setInspectorOpen(false);
  }, [searchParams, setSearchParams]);

  const openInspector = useCallback((tab: InspectorTab = "overview") => {
    setInspectorTab(tab);
    setInspectorOpen(true);
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
  }, []);

  const openAsk = useCallback(() => {
    setInspectorTab("ask");
    setInspectorOpen(true);
  }, []);

  useEffect(() => {
    const handleEntitySelection = (event: Event) => {
      const detail = (event as CustomEvent<AICISEntity>).detail;
      if (!detail?.id || !detail?.type || !detail?.name) return;
      selectEntity(detail);
    };

    window.addEventListener("aicis:select-entity", handleEntitySelection);
    return () => window.removeEventListener("aicis:select-entity", handleEntitySelection);
  }, [selectEntity]);

  const value = useMemo<IntelligenceOSContextValue>(
    () => ({
      selectedEntity,
      isInspectorOpen,
      activeInspectorTab,
      isCommandPaletteOpen,
      selectEntity,
      clearEntity,
      openInspector,
      closeInspector,
      setInspectorTab,
      openAsk,
      setCommandPaletteOpen,
    }),
    [
      activeInspectorTab,
      clearEntity,
      closeInspector,
      isCommandPaletteOpen,
      isInspectorOpen,
      openAsk,
      openInspector,
      selectEntity,
      selectedEntity,
    ],
  );

  return <IntelligenceOSContext.Provider value={value}>{children}</IntelligenceOSContext.Provider>;
};

export const useIntelligenceOS = () => {
  const context = useContext(IntelligenceOSContext);
  if (!context) {
    throw new Error("useIntelligenceOS must be used inside IntelligenceOSProvider");
  }
  return context;
};
