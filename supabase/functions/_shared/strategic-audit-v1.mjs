
export const STRATEGIC_AUDIT_VERSION = "aicis-strategic-audit-v1";

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = normalize(value[key]);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  }
  if (value === undefined) return undefined;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

export function canonicalStrategicJson(value) {
  return JSON.stringify(normalize(value));
}

export async function hashStrategicSnapshot(value) {
  const canonical = canonicalStrategicJson(value);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return {
    audit_version: STRATEGIC_AUDIT_VERSION,
    algorithm: "SHA-256",
    hash,
    canonical_length: canonical.length,
    semantics: "fingerprint_of_pre_outcome_strategic_snapshot_not_blockchain_or_external_timestamp",
  };
}
