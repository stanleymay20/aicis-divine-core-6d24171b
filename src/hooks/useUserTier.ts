import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AccessTier = "free" | "sovereign" | "enterprise";

const TIER_RANK: Record<AccessTier, number> = {
  free: 0,
  sovereign: 1,
  enterprise: 2,
};

export const tierMeetsRequirement = (
  current: AccessTier,
  required: AccessTier
): boolean => TIER_RANK[current] >= TIER_RANK[required];

export const useUserTier = () => {
  const { user, loading: authLoading } = useAuth();

  const query = useQuery({
    queryKey: ["user-tier", user?.id ?? "anon"],
    enabled: !!user?.id,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<AccessTier> => {
      if (!user?.id) return "free";
      const { data, error } = await supabase.rpc("get_user_tier", {
        _user_id: user.id,
      });
      if (error) throw error;
      const t = (data as string) ?? "free";
      if (t === "enterprise" || t === "sovereign" || t === "free") return t;
      return "free";
    },
  });

  return {
    tier: (query.data ?? "free") as AccessTier,
    loading: authLoading || query.isLoading,
    error: query.error,
  };
};
