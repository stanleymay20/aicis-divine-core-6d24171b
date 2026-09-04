export const AICIS_SOVEREIGN_RUNTIME_CONTRACT_VERSION = "aicis-sovereign-runtime-contract-v1";

const ALLOWED_STATUSES = new Set(["research_candidate", "benchmark_locked"]);
const ALLOWED_RUNTIMES = new Set(["vllm", "sglang"]);
const SHA256_RE = /^[a-f0-9]{64}$/i;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/i;
const REVISION_RE = /^[a-f0-9]{40}$/i;

export function evaluateSovereignRuntimeCandidate(candidate) {
  const reasons = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return Object.freeze({ admissible: false, benchmark_locked: false, reasons: ["candidate_missing_or_invalid"] });
  }

  if (candidate.contract_version !== AICIS_SOVEREIGN_RUNTIME_CONTRACT_VERSION) {
    reasons.push("contract_version_mismatch");
  }
  if (!ALLOWED_STATUSES.has(candidate.status)) reasons.push("status_missing_or_invalid");
  if (candidate.production_activation_allowed !== false) reasons.push("production_activation_must_be_false_in_v1");
  if (candidate.external_model_fallback !== false) reasons.push("external_model_fallback_forbidden");
  if (candidate.authoritative_scientific_state_outside_llm !== true) {
    reasons.push("scientific_state_must_remain_outside_llm");
  }

  const primary = candidate.runtime?.primary;
  if (!primary || !ALLOWED_RUNTIMES.has(primary.name)) reasons.push("primary_runtime_missing_or_invalid");
  if (primary?.protocol !== "openai-compatible") reasons.push("primary_runtime_protocol_invalid");
  if (!new Set(["private", "loopback"]).has(primary?.network_boundary)) reasons.push("runtime_network_boundary_not_private");
  if (primary?.public_ingress !== false) reasons.push("runtime_public_ingress_forbidden");
  if (primary?.name === "vllm" && primary?.reverse_proxy_required !== true) {
    reasons.push("vllm_reverse_proxy_required");
  }
  if (primary?.name === "vllm" && primary?.deny_unproxied_inference_endpoints !== true) {
    reasons.push("vllm_unproxied_inference_must_be_denied");
  }
  if (hasMutableLatestTag(primary?.container_image)) reasons.push("mutable_latest_container_tag_forbidden");

  const network = candidate.network_policy;
  if (network?.model_server_public_ingress !== false) reasons.push("model_server_public_ingress_forbidden");
  if (network?.model_server_egress !== "deny_by_default") reasons.push("model_server_egress_must_deny_by_default");
  if (network?.gateway_to_runtime_only !== true) reasons.push("gateway_to_runtime_only_required");
  if (network?.runtime_redirects !== "forbidden") reasons.push("runtime_redirects_must_be_forbidden");
  if (network?.secrets_in_browser !== false) reasons.push("browser_secrets_forbidden");

  const models = Array.isArray(candidate.models) ? candidate.models : [];
  if (models.length === 0) reasons.push("model_candidates_missing");
  for (const model of models) {
    if (!model?.model_id || typeof model.model_id !== "string") reasons.push("model_id_missing");
    if (!model?.declared_license || typeof model.declared_license !== "string") reasons.push("model_license_missing");
    if (model?.production_approved !== false) reasons.push("model_production_approval_forbidden_in_v1");
    if (!Array.isArray(model?.serving_compatibility) || !model.serving_compatibility.includes(primary?.name)) {
      reasons.push(`primary_runtime_not_declared_compatible:${model?.model_id ?? "unknown"}`);
    }
  }

  const gate = candidate.evaluation_gate;
  if (gate?.automatic_promotion !== false) reasons.push("automatic_promotion_forbidden");
  if (gate?.deterministic_baseline_required !== true) reasons.push("deterministic_baseline_required");
  if (gate?.scientific_forecast_claims_from_llm_forbidden !== true) reasons.push("llm_scientific_forecast_claims_must_be_forbidden");

  const structuralReasons = [...new Set(reasons)];
  const admissible = structuralReasons.length === 0;
  const lockReasons = admissible ? benchmarkLockReasons(candidate) : ["candidate_not_admissible"];

  return Object.freeze({
    admissible,
    benchmark_locked: admissible && candidate.status === "benchmark_locked" && lockReasons.length === 0,
    reasons: structuralReasons,
    benchmark_lock_reasons: Object.freeze(lockReasons),
  });
}

export function assertBenchmarkLocked(candidate) {
  const result = evaluateSovereignRuntimeCandidate(candidate);
  if (!result.admissible || !result.benchmark_locked) {
    const error = new Error(`AICIS sovereign runtime candidate is not benchmark-locked: ${[
      ...result.reasons,
      ...result.benchmark_lock_reasons,
    ].join(", ")}`);
    error.code = "AICIS_SOVEREIGN_RUNTIME_NOT_BENCHMARK_LOCKED";
    error.reasons = Object.freeze([...result.reasons, ...result.benchmark_lock_reasons]);
    throw error;
  }
  return deepFreeze(structuredClone(candidate));
}

function benchmarkLockReasons(candidate) {
  const reasons = [];
  if (candidate.status !== "benchmark_locked") reasons.push("status_not_benchmark_locked");

  const runtimes = [candidate.runtime?.primary, candidate.runtime?.secondary].filter(Boolean);
  for (const runtime of runtimes) {
    if (!runtime.version || typeof runtime.version !== "string") {
      reasons.push(`runtime_version_unpinned:${runtime.name ?? "unknown"}`);
    } else if (isMutableVersion(runtime.version)) {
      reasons.push(`runtime_version_mutable:${runtime.name ?? "unknown"}`);
    }
    if (!DIGEST_RE.test(String(runtime.container_digest ?? ""))) {
      reasons.push(`runtime_container_digest_unpinned:${runtime.name ?? "unknown"}`);
    }
    if (hasMutableLatestTag(runtime.container_image)) {
      reasons.push(`runtime_mutable_tag_forbidden:${runtime.name ?? "unknown"}`);
    }
  }

  for (const model of candidate.models ?? []) {
    const id = model?.model_id ?? "unknown";
    if (!REVISION_RE.test(String(model?.revision ?? ""))) reasons.push(`model_revision_unpinned:${id}`);
    if (!SHA256_RE.test(String(model?.weights_manifest_sha256 ?? ""))) reasons.push(`weights_manifest_unpinned:${id}`);
    if (!SHA256_RE.test(String(model?.tokenizer_sha256 ?? ""))) reasons.push(`tokenizer_digest_unpinned:${id}`);
    if (!SHA256_RE.test(String(model?.config_sha256 ?? ""))) reasons.push(`config_digest_unpinned:${id}`);
  }
  return [...new Set(reasons)];
}

function hasMutableLatestTag(image) {
  if (typeof image !== "string" || !image) return false;
  const withoutDigest = image.split("@")[0];
  return /:latest$/i.test(withoutDigest);
}

function isMutableVersion(version) {
  const normalized = String(version ?? "").trim().toLowerCase();
  return normalized === "latest" || normalized === "main" || normalized === "master" || normalized === "nightly" || normalized === "dev";
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
