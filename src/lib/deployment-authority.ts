/**
 * AICIS deployment authority marker.
 *
 * Runtime behavior: none.
 * Purpose: make the post-reconciliation main state visible to the connected
 * Lovable deployment pipeline after branch-history consolidation.
 */
export const AICIS_DEPLOYMENT_AUTHORITY = {
  branch: "main",
  reconciliation: "2026-09-29",
} as const;
