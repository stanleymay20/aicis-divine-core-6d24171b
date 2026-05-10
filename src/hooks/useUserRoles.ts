import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AICISRole = "admin" | "operator" | "analyst" | "viewer" | string;

export function useUserRoles() {
  const { user } = useAuth();

  const rolesQuery = useQuery({
    queryKey: ["aicis-user-roles", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const metadataRoles = [
        user?.app_metadata?.role,
        user?.user_metadata?.role,
        ...(Array.isArray(user?.app_metadata?.roles) ? user?.app_metadata?.roles : []),
      ].filter(Boolean) as string[];

      const { data } = await supabase
        .from("user_roles" as any)
        .select("role")
        .eq("user_id", user!.id);

      const dbRoles = (data ?? []).map((row: any) => row.role).filter(Boolean);
      return Array.from(new Set([...metadataRoles, ...dbRoles])) as AICISRole[];
    },
  });

  const roles = rolesQuery.data ?? [];
  const isAdmin = roles.includes("admin");
  const isOperator = isAdmin || roles.includes("operator");
  const isAnalyst = isOperator || roles.includes("analyst");

  return {
    roles,
    isAdmin,
    isOperator,
    isAnalyst,
    isLoading: rolesQuery.isLoading,
  };
}
