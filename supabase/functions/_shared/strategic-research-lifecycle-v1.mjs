
export const STRATEGIC_RESEARCH_LIFECYCLE_VERSION = "aicis-strategic-research-lifecycle-v1";

const ALLOWED = {
  pending: new Set(["in_progress", "blocked", "resolved", "stale", "cancelled"]),
  in_progress: new Set(["blocked", "resolved", "stale", "cancelled"]),
  blocked: new Set(["in_progress", "resolved", "stale", "cancelled"]),
  resolved: new Set(),
  stale: new Set(),
  cancelled: new Set(),
};

export function validateStrategicResearchTransition(fromStatus, toStatus) {
  const from = String(fromStatus || "").trim();
  const to = String(toStatus || "").trim();

  if (!Object.prototype.hasOwnProperty.call(ALLOWED, from)) {
    return { ok: false, reason: "unknown_current_status" };
  }
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, to)) {
    return { ok: false, reason: "unknown_target_status" };
  }
  if (from === to) {
    return { ok: true, reason: "no_change" };
  }
  if (!ALLOWED[from].has(to)) {
    return { ok: false, reason: "invalid_terminal_or_backward_transition" };
  }
  return { ok: true, reason: "allowed" };
}

export function normalizeResearchEvidenceRefs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      source_id: String(item.source_id || "").trim(),
      observed_at: String(item.observed_at || "").trim(),
      sha256: item.sha256 ? String(item.sha256).trim() : null,
      citation_id: item.citation_id ? String(item.citation_id).trim() : null,
      source_url: item.source_url ? String(item.source_url).trim() : null,
      note: item.note ? String(item.note).trim() : null,
    }))
    .filter((item) =>
      item.source_id &&
      item.observed_at &&
      Number.isFinite(Date.parse(item.observed_at)) &&
      (
        (typeof item.sha256 === "string" && /^[a-f0-9]{64}$/i.test(item.sha256)) ||
        Boolean(item.citation_id)
      )
    );
}

export function normalizeResearchResolution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    result[key] = raw;
  }
  return result;
}
