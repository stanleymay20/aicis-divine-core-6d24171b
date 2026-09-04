export const AICIS_SOVEREIGN_AI_POLICY_VERSION = "aicis-sovereign-ai-policy-v1";
export const AICIS_AI_MODES = Object.freeze(["sovereign", "hybrid", "research"]);

export class AiSovereigntyPolicyError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "AiSovereigntyPolicyError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function normalizeAiMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (!AICIS_AI_MODES.includes(mode)) {
    throw new AiSovereigntyPolicyError(
      "AICIS_AI_MODE must be explicitly configured as sovereign, hybrid, or research",
      "ai_mode_missing_or_invalid",
    );
  }
  return mode;
}

export function parseSovereignHostAllowlist(value) {
  return Object.freeze(
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function evaluateAiRoute({
  mode,
  endpoint,
  sovereignHosts = [],
  apiKeyPresent = false,
}) {
  const normalizedMode = normalizeAiMode(mode);
  const url = parseModelEndpoint(endpoint);
  const hostname = normalizeHostname(url.hostname);
  const trustClass = classifyEndpointTrust(hostname, sovereignHosts);

  if (normalizedMode === "sovereign" && trustClass === "external") {
    throw new AiSovereigntyPolicyError(
      "External model endpoints are forbidden in sovereign mode",
      "external_endpoint_forbidden_in_sovereign_mode",
      { endpoint_host: hostname },
    );
  }

  if (
    normalizedMode === "sovereign" &&
    trustClass === "sovereign_allowlisted" &&
    !apiKeyPresent
  ) {
    throw new AiSovereigntyPolicyError(
      "Public sovereign model endpoints require configured authentication",
      "public_sovereign_endpoint_requires_authentication",
      { endpoint_host: hostname },
    );
  }

  return Object.freeze({
    policy_version: AICIS_SOVEREIGN_AI_POLICY_VERSION,
    mode: normalizedMode,
    endpoint_host: hostname,
    endpoint_protocol: url.protocol.replace(":", ""),
    trust_class: trustClass,
    external_network_allowed: normalizedMode !== "sovereign",
  });
}

export function classifyEndpointTrust(hostname, sovereignHosts = []) {
  const normalized = normalizeHostname(hostname);
  if (isLoopbackHostname(normalized) || isPrivateIpv4(normalized)) return "local_or_private";

  const allowlist = Array.isArray(sovereignHosts)
    ? sovereignHosts.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : parseSovereignHostAllowlist(sovereignHosts);

  if (allowlist.some((pattern) => hostnameMatchesPattern(normalized, pattern))) {
    return "sovereign_allowlisted";
  }

  return "external";
}

function parseModelEndpoint(endpoint) {
  const value = String(endpoint ?? "").trim();
  if (!value) {
    throw new AiSovereigntyPolicyError(
      "AICIS_MODEL_ENDPOINT must be explicitly configured",
      "model_endpoint_missing",
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AiSovereigntyPolicyError(
      "AICIS_MODEL_ENDPOINT must be a valid URL",
      "model_endpoint_invalid",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AiSovereigntyPolicyError(
      "AICIS_MODEL_ENDPOINT must use http or https",
      "model_endpoint_protocol_forbidden",
      { endpoint_protocol: url.protocol.replace(":", "") },
    );
  }

  if (url.username || url.password) {
    throw new AiSovereigntyPolicyError(
      "Credentials must not be embedded in AICIS_MODEL_ENDPOINT",
      "model_endpoint_embedded_credentials_forbidden",
    );
  }

  return url;
}

function normalizeHostname(hostname) {
  return String(hostname ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return false;

  const [a, b] = octets;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function hostnameMatchesPattern(hostname, rawPattern) {
  const pattern = normalizeHostname(rawPattern);
  if (!pattern) return false;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return hostname !== suffix && hostname.endsWith(`.${suffix}`);
  }
  return hostname === pattern;
}
