import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  // Publish builds run from Git main, where the gitignored .env is absent.
  // These are the publishable (anon) backend coordinates — safe to ship in the
  // browser bundle — so the live site always has its Cloud connection.
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      process.env.VITE_SUPABASE_URL ?? "https://psonnnuhjjskrdazrakk.supabase.co",
    ),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o",
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
