import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  IntelligenceOSContext,
  type IntelligenceOSContextValue,
} from "@/contexts/intelligence-os-context";
import type { AICISEntity, AICISEntityType, InspectorTab } from "@/types/intelligence-os";

const ENTITY_PARAM = "entity";
const ENTITY_SESSION_CACHE_KEY = "aicis:intelligence-entity-cache";
const MAX_SESSION_ENTITIES = 20;

const isEntity = (value: unknown): value is AICISEntity => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entity = value as Partial<AICISEntity>;
  return (
    typeof entity.id === "string" &&
    entity.id.length > 0 &&
    typeof entity.type === "string" &&
    entity.type.length > 0 &&
    typeof entity.name === "string" &&
    entity.name.length > 0
  );
};

const readSessionCache = (): Record<string, AICISEntity> => {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.sessionStorage.getItem(ENTITY_SESSION_CACHE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, AICISEntity] => isEntity(entry[1]))
        .slice(-MAX_SESSION_ENTITIES),
    );
  } catch {
    return {};
  }
};

const writeSessionCache = (cache: Record<string, AICISEntity>) => {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      ENTITY_SESSION_CACHE_KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(cache).slice(-MAX_SESSION_ENTITIES),
        ),
      ),
    );
  } catch {
    // Session storage may be disabled in hardened/private browsing contexts.
  }
};

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
  const [entityCache, setEntityCache] = useState<Record<string, AICISEntity>>(readSessionCache);
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
      setEntityCache((current) => {
        const orderedEntries = [
          ...Object.entries(current).filter(([existingKey]) => existingKey !== key),
          [key, entity] as const,
        ].slice(-MAX_SESSION_ENTITIES);
        const nextCache = Object.fromEntries(orderedEntries);
        writeSessionCache(nextCache);
        return nextCache;
      });

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
