import { type ReactNode } from "react";
import { ErrorBoundary } from "./error-boundary";

interface PanelBoundaryProps {
  children: ReactNode;
  className?: string;
}

/**
 * Per-panel error boundary. Drop-in wrapper used inside dashboard pages so
 * one failing panel never blanks the entire page. Pairs with PageBoundary
 * (page-level) and QueryPanel (loading + empty + retry).
 */
export function PanelBoundary({ children, className }: PanelBoundaryProps) {
  return (
    <ErrorBoundary compact>
      {className ? <div className={className}>{children}</div> : children}
    </ErrorBoundary>
  );
}
