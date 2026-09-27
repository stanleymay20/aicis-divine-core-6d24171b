
export const STRATEGIC_RESEARCH_COMPLETION_VERSION = "aicis-strategic-research-completion-v1";

const COMPLETION_MAP = {
  supplier_quote_verified: "refresh_supplier_quote",
  buyer_quote_verified: "refresh_buyer_quote",
  logistics_route_verified: "refresh_route_quote",
  reference_fx_attached: "verified_fx_normalization",
  executable_fx_verified: "obtain_executable_fx_quote",
  business_contact_verified: "verify_business_contact",
  landed_cost_verified: "verify_landed_cost_evidence",
  landed_cost_execution_evidence_verified: "upgrade_landed_cost_execution_evidence",
};

export function researchActionKindForCompletion(completionKind) {
  return COMPLETION_MAP[String(completionKind || "").trim()] || null;
}

export function buildResearchCompletionResolution(completionKind, metadata = {}) {
  const actionKind = researchActionKindForCompletion(completionKind);
  if (!actionKind) {
    return {
      ok: false,
      reason: "unsupported_completion_kind",
      action_kind: null,
      resolution: null,
    };
  }

  return {
    ok: true,
    reason: "supported",
    action_kind: actionKind,
    resolution: {
      disposition: "evidence_satisfied_blocker",
      completion_kind: String(completionKind),
      action_kind: actionKind,
      completed_at: new Date().toISOString(),
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata
        : {},
    },
  };
}
