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
      if (!user?.id) return [];

      // Authorization roles may come from server-controlled app_metadata or the
      // database. Never trust user_metadata: users can edit it themselves.
      const metadataRoles = [
        user?.app_metadata?.role,
        ...(Array.isArray(user?.app_metadata?.roles) ? user.app_metadata.roles : []),
      ].filter(Boolean) as string[];

      const { data, error } = await supabase
        .from("user_roles" as any)
        .select("role")
        .eq("user_id", user.id);

      if (error) throw error;

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
    error: rolesQuery.error,
  };
}
