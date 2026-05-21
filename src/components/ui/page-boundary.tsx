import { type ReactNode, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from "./error-boundary";

interface PageBoundaryProps {
  children: ReactNode;
  /**
   * Optional scope key. When the user clicks "Try Again" on the boundary,
   * queries matching this key prefix are invalidated. Defaults to no-op.
   */
  scope?: string;
}

/**
 * Page-level error boundary used by every data-bound route.
 *
 * Wraps the page in an ErrorBoundary (full-page fallback with Retry button)
 * and forces a fresh remount + query invalidation when the user retries,
 * so transient network/auth failures recover without a full page reload.
 *
 * Inline loading / empty states still belong to each page or QueryPanel;
 * this component only guarantees consistent error recovery.
 */
export function PageBoundary({ children, scope }: PageBoundaryProps) {
  const qc = useQueryClient();
  const [resetKey, setResetKey] = useState(0);

  const handleReset = useCallback(() => {
    if (scope) {
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey?.[0] ?? "").startsWith(scope) });
    } else {
      qc.invalidateQueries();
    }
    setResetKey((k) => k + 1);
  }, [qc, scope]);

  return (
    <ErrorBoundary key={resetKey} onReset={handleReset}>
      {children}
    </ErrorBoundary>
  );
}
