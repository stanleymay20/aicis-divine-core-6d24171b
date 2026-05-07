import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface RelevancePreferences {
  organization_id?: string | null;
  organization_name?: string | null;
  industries: string[];
  domains: string[];
  countries: string[];
  watched_entities: string[];
  keywords: string[];
  risk_priorities: string[];
  operating_regions: string[];
  business_functions: string[];
  alert_preferences: Record<string, unknown>;
}

export const EMPTY_PREFS: RelevancePreferences = {
  organization_id: null,
  organization_name: null,
  industries: [],
  domains: [],
  countries: [],
  watched_entities: [],
  keywords: [],
  risk_priorities: [],
  operating_regions: [],
  business_functions: [],
  alert_preferences: {},
};

export function useRelevancePreferences() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<RelevancePreferences>(EMPTY_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [hasRow, setHasRow] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("aicis_relevance_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setHasRow(true);
        setPrefs({
          organization_id: data.organization_id,
          organization_name: data.organization_name,
          industries: data.industries || [],
          domains: data.domains || [],
          countries: data.countries || [],
          watched_entities: data.watched_entities || [],
          keywords: data.keywords || [],
          risk_priorities: data.risk_priorities || [],
          operating_regions: data.operating_regions || [],
          business_functions: data.business_functions || [],
          alert_preferences: (data.alert_preferences as Record<string, unknown>) || {},
        });
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const save = useCallback(
    async (next: RelevancePreferences) => {
      setPrefs(next);
      if (!user?.id) return { error: new Error("Not signed in") };
      const { error } = await supabase
        .from("aicis_relevance_preferences")
        .upsert({ user_id: user.id, ...next } as any, { onConflict: "user_id" });
      if (!error) setHasRow(true);
      return { error };
    },
    [user?.id]
  );

  return { prefs, save, loaded, hasRow };
}

/** Build the organization_context payload for score-relevance edge function. */
export function buildOrganizationContext(p: RelevancePreferences) {
  return {
    organization_id: p.organization_id || null,
    name: p.organization_name || null,
    industries: p.industries,
    domains: p.domains,
    countries: p.countries,
    watched_entities: p.watched_entities,
    keywords: p.keywords,
    risk_priorities: p.risk_priorities,
    operating_regions: p.operating_regions,
    business_functions: p.business_functions,
    alert_preferences: p.alert_preferences,
  };
}
