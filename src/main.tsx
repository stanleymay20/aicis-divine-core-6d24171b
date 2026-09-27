import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import "./index.css";

// Process an emailed recovery credential before loading the application's
// PKCE client, which otherwise rejects an implicit callback and removes it.
const start = async () => {
  if (location.pathname === "/reset-password" && new URLSearchParams(location.hash.slice(1)).get("type") === "recovery") {
    const { recoveryAuth } = await import("./lib/recoveryAuth.ts");
    await recoveryAuth.initialize();
  }
  const { default: App } = await import("./App.tsx");
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(<HelmetProvider><App /></HelmetProvider>);
};

void start();
