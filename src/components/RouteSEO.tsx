import { useLocation } from "react-router-dom";
import { SEO } from "@/components/SEO";
import { resolveRouteSEO } from "@/lib/seo/registry";

/**
 * Resolves the current pathname to a SEO registry entry and emits
 * <SEO />. Pages that mount their own <SEO /> override these tags
 * via react-helmet-async deduplication.
 *
 * Mounted once inside <BrowserRouter> in App.tsx so every route gets
 * baseline title / description / canonical / robots / og:* without
 * touching individual page files.
 */
export function RouteSEO() {
  const { pathname } = useLocation();
  const entry = resolveRouteSEO(pathname);
  return (
    <SEO
      title={entry.title}
      description={entry.description}
      path={pathname}
      noindex={entry.noindex}
    />
  );
}
