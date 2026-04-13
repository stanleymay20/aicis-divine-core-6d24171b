/**
 * Hook for searching entities with debounce.
 */
import { useState, useCallback, useRef } from "react";
import { searchEntitiesDirect, type CanonicalEntity, type EntityType } from "@/lib/entities/entityService";

export function useEntitySearch(options?: { entityType?: EntityType; iso3?: string; limit?: number }) {
  const [results, setResults] = useState<CanonicalEntity[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((query: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query || query.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const data = await searchEntitiesDirect(query, {
          entity_type: options?.entityType,
          iso3: options?.iso3,
          limit: options?.limit || 10,
        });
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, [options?.entityType, options?.iso3, options?.limit]);

  const clear = useCallback(() => {
    setResults([]);
    setIsSearching(false);
  }, []);

  return { results, isSearching, search, clear };
}
