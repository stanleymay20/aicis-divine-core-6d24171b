/* eslint-disable react-refresh/only-export-components -- Compatibility barrel: existing callers import both the hook and provider from this path. */
import { useContext } from "react";
import { AuthContext } from "@/contexts/AuthContext";

export { AuthProvider } from "@/components/auth/AuthProvider";

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
