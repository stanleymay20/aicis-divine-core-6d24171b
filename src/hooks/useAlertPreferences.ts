import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type Severity = "critical" | "high" | "medium" | "low";

export interface AlertPreferences {
  min_severity: Severity;
  divisions: string[];
  countries: string[];
  mute_keywords: string[];
  show_acknowledged: boolean;
}

export const DEFAULT_PREFS: AlertPreferences = {
  min_severity: "low",
  divisions: [],
  countries: [],
  mute_keywords: [],
  show_acknowledged: true,
};

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Persisted per-user alert preferences with optimistic local cache. */
export function useAlertPreferences() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<AlertPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);

  // Load
  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("alert_preferences")
        .select("min_severity,divisions,countries,mute_keywords,show_acknowledged")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setPrefs({
          min_severity: (data.min_severity as Severity) || "low",
          divisions: data.divisions || [],
          countries: data.countries || [],
          mute_keywords: data.mute_keywords || [],
          show_acknowledged: data.show_acknowledged ?? true,
        });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Save (upsert) — optimistic
  const save = useCallback(
    async (next: AlertPreferences) => {
      setPrefs(next);
      if (!user?.id) return;
      await supabase
        .from("alert_preferences")
        .upsert(
          { user_id: user.id, ...next },
          { onConflict: "user_id" }
        );
    },
    [user?.id]
  );

  return { prefs, save, loading };
}

/** Pure filter — used by AlertsPanel and elsewhere. */
export function applyAlertPreferences<
  T extends {
    severity: Severity | string;
    division?: string;
    country?: string | null;
    title?: string;
    message?: string;
    acknowledged?: boolean;
  }
>(alerts: T[], prefs: AlertPreferences): T[] {
  const minRank = SEVERITY_RANK[prefs.min_severity] ?? 1;
  const muteLc = prefs.mute_keywords
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const divisionsLc = prefs.divisions.map((d) => d.toLowerCase());
  const countriesLc = prefs.countries.map((c) => c.toLowerCase());

  return alerts.filter((a) => {
    const sevRank = SEVERITY_RANK[a.severity as Severity] ?? 1;
    if (sevRank < minRank) return false;

    if (!prefs.show_acknowledged && a.acknowledged) return false;

    if (
      divisionsLc.length > 0 &&
      !divisionsLc.includes((a.division || "").toLowerCase())
    ) {
      return false;
    }

    if (
      countriesLc.length > 0 &&
      !countriesLc.includes((a.country || "").toLowerCase())
    ) {
      return false;
    }

    if (muteLc.length > 0) {
      const hay = `${a.title || ""} ${a.message || ""}`.toLowerCase();
      if (muteLc.some((k) => hay.includes(k))) return false;
    }

    return true;
  });
}

/** Counts for UI summaries. */
export function summarizePreferences(p: AlertPreferences): string {
  const bits: string[] = [];
  if (p.min_severity !== "low") bits.push(`${p.min_severity}+`);
  if (p.divisions.length) bits.push(`${p.divisions.length} division${p.divisions.length > 1 ? "s" : ""}`);
  if (p.countries.length) bits.push(`${p.countries.length} countr${p.countries.length > 1 ? "ies" : "y"}`);
  if (p.mute_keywords.length) bits.push(`${p.mute_keywords.length} muted`);
  if (!p.show_acknowledged) bits.push("hide read");
  return bits.length ? bits.join(" · ") : "All alerts";
}
