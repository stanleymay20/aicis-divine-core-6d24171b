import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Public (non-secret) backend connection values. Publish builds do not always
// receive the local .env, so these defaults guarantee the live bundle can
// reach the backend. The anon key is publishable; RLS protects data.
const PUBLIC_SUPABASE_URL = "https://psonnnuhjjskrdazrakk.supabase.co";
const PUBLIC_SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzb25ubnVoampza3JkYXpyYWtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2OTU0NzAsImV4cCI6MjA3NTI3MTQ3MH0.7ZqxEzVc9mVLJrbI5HgesAmKaHWlNt9oB4lZta_in6o";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      process.env.VITE_SUPABASE_URL || PUBLIC_SUPABASE_URL,
    ),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY || PUBLIC_SUPABASE_KEY,
    ),
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(
      process.env.VITE_SUPABASE_PROJECT_ID || "psonnnuhjjskrdazrakk",
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
