import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type WatchType = "country" | "region" | "hotspot";

export interface WatchlistItem {
  id: string;
  user_id: string;
  watch_type: WatchType;
  country_iso3: string | null;
  region_id: string | null;
  hotspot_key: string | null;
  label: string;
  priority_level: string;
  is_active: boolean;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WatchlistEvent {
  id: string;
  watchlist_item_id: string;
  event_type: string;
  event_summary: string;
  severity: string;
  metadata: Record<string, any>;
  created_at: string;
}

const WATCHLIST_KEY = ["watchlist-items"];
const WATCHLIST_EVENTS_KEY = ["watchlist-events"];

export function useWatchlist() {
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: WATCHLIST_KEY,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from("watchlist_items")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      return (data || []) as WatchlistItem[];
    },
  });

  const { data: events = [] } = useQuery({
    queryKey: WATCHLIST_EVENTS_KEY,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      // Get item ids first
      const { data: myItems } = await supabase
        .from("watchlist_items")
        .select("id")
        .eq("user_id", user.id);
      if (!myItems?.length) return [];
      const ids = myItems.map((i: any) => i.id);
      const { data } = await supabase
        .from("watchlist_events")
        .select("*")
        .in("watchlist_item_id", ids)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data || []) as WatchlistEvent[];
    },
    enabled: items.length > 0,
  });

  const addItem = useMutation({
    mutationFn: async (params: {
      watch_type: WatchType;
      label: string;
      country_iso3?: string;
      region_id?: string;
      hotspot_key?: string;
      priority_level?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("watchlist_items").insert({
        user_id: user.id,
        watch_type: params.watch_type,
        label: params.label,
        country_iso3: params.country_iso3 || null,
        region_id: params.region_id || null,
        hotspot_key: params.hotspot_key || null,
        priority_level: params.priority_level || "normal",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WATCHLIST_KEY });
      toast.success("Added to watchlist");
    },
    onError: () => toast.error("Failed to save watch item"),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("watchlist_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WATCHLIST_KEY });
      toast.success("Removed from watchlist");
    },
  });

  const updatePriority = useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: string }) => {
      const { error } = await supabase.from("watchlist_items").update({ priority_level: priority }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: WATCHLIST_KEY }),
  });

  const isWatching = (type: WatchType, key: string) => {
    return items.some((i) => {
      if (type === "country") return i.watch_type === "country" && i.country_iso3 === key;
      if (type === "region") return i.watch_type === "region" && i.region_id === key;
      return i.watch_type === "hotspot" && i.hotspot_key === key;
    });
  };

  const toggleWatch = (params: {
    watch_type: WatchType;
    label: string;
    country_iso3?: string;
    region_id?: string;
    hotspot_key?: string;
  }) => {
    const key = params.country_iso3 || params.region_id || params.hotspot_key || "";
    const existing = items.find((i) => {
      if (params.watch_type === "country") return i.watch_type === "country" && i.country_iso3 === key;
      if (params.watch_type === "region") return i.watch_type === "region" && i.region_id === key;
      return i.watch_type === "hotspot" && i.hotspot_key === key;
    });
    if (existing) {
      removeItem.mutate(existing.id);
    } else {
      addItem.mutate(params);
    }
  };

  return { items, events, isLoading, addItem, removeItem, updatePriority, isWatching, toggleWatch };
}
