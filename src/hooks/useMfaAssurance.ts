import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AuthenticatorAssuranceLevel = "aal1" | "aal2" | null;

export const MFA_ASSURANCE_QUERY_KEY = "aicis-mfa-assurance";

export const useMfaAssurance = () => {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: [MFA_ASSURANCE_QUERY_KEY, user?.id ?? "anon"],
    enabled: Boolean(user?.id),
    staleTime: 0,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;

      return {
        currentLevel: (data.currentLevel ?? null) as AuthenticatorAssuranceLevel,
        nextLevel: (data.nextLevel ?? null) as AuthenticatorAssuranceLevel,
        currentAuthenticationMethods: data.currentAuthenticationMethods ?? [],
      };
    },
  });

  return {
    currentLevel: query.data?.currentLevel ?? null,
    nextLevel: query.data?.nextLevel ?? null,
    currentAuthenticationMethods: query.data?.currentAuthenticationMethods ?? [],
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};
