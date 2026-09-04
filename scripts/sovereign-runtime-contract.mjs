export const AICIS_SOVEREIGN_RUNTIME_CONTRACT_VERSION = "aicis-sovereign-runtime-contract-v1";

const ALLOWED_STATUSES = new Set(["research_candidate", "benchmark_locked"]);
const ALLOWED_RUNTIMES = new Set(["vllm", "sglang"]);
const SHA256_RE = /^[a-f0-9]{64}$/i;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/i;
const REVISION_RE = /^[a-f0-9]{40}$/i;
const EXACT_VERSION_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z][0-9A-Za-z.-]*)?$/;

export const REQUIRED_SOVEREIGN_RUNTIME_BENCHMARK_DIMENSIONS = Object.freeze([
  "structured_output_validity",
  "grounded_task_accuracy",
  "unsupported_assertion_rate",
  "abstention_behavior",
  "prompt_injection_resistance",
  "latency",
  "throughput",
  "memory_footprint",
  "failure_recovery",
]);

export function evaluateSovereignRuntimeCandidate(candidate) {
  const reasons = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return Object.freeze({
      admissible: false,
      benchmark_locked: false,
      reasons: Object.freeze(["candidate_missing_or_invalid"]),
      benchmark_lock_reasons: Object.freeze(["candidate_not_admissible"]),
    });
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
  validateRuntimeBoundary(primary, "primary", reasons);
  if (primary?.name === "vllm" && primary?.reverse_proxy_required !== true) {
    reasons.push("vllm_reverse_proxy_required:primary");
  }
  if (primary?.name === "vllm" && primary?.deny_unproxied_inference_endpoints !== true) {
    reasons.push("vllm_unproxied_inference_must_be_denied:primary");
  }

  const secondary = candidate.runtime?.secondary;
  if (secondary) {
    validateRuntimeBoundary(secondary, "secondary", reasons);
    if (secondary.benchmark_only !== true) reasons.push("secondary_runtime_must_be_benchmark_only");
    if (secondary.name === "vllm" && secondary.reverse_proxy_required !== true) {
      reasons.push("vllm_reverse_proxy_required:secondary");
    }
    if (secondary.name === "vllm" && secondary.deny_unproxied_inference_endpoints !== true) {
      reasons.push("vllm_unproxied_inference_must_be_denied:secondary");
    }
  }

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
  const configuredDimensions = new Set(Array.isArray(gate?.required_dimensions) ? gate.required_dimensions : []);
  for (const dimension of REQUIRED_SOVEREIGN_RUNTIME_BENCHMARK_DIMENSIONS) {
    if (!configuredDimensions.has(dimension)) reasons.push(`required_benchmark_dimension_missing:${dimension}`);
  }

  const structuralReasons = Object.freeze([...new Set(reasons)]);
  const admissible = structuralReasons.length === 0;
  const lockReasons = Object.freeze(admissible ? benchmarkLockReasons(candidate) : ["candidate_not_admissible"]);

  return Object.freeze({
    admissible,
    benchmark_locked: admissible && candidate.status === "benchmark_locked" && lockReasons.length === 0,
    reasons: structuralReasons,
    benchmark_lock_reasons: lockReasons,
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

function validateRuntimeBoundary(runtime, role, reasons) {
  if (!runtime || !ALLOWED_RUNTIMES.has(runtime.name)) reasons.push(`${role}_runtime_missing_or_invalid`);
  if (runtime?.protocol !== "openai-compatible") reasons.push(`${role}_runtime_protocol_invalid`);
  if (!new Set(["private", "loopback"]).has(runtime?.network_boundary)) {
    reasons.push(`${role}_runtime_network_boundary_not_private`);
  }
  if (runtime?.public_ingress !== false) reasons.push(`${role}_runtime_public_ingress_forbidden`);
  if (hasMutableLatestTag(runtime?.container_image)) reasons.push(`${role}_runtime_mutable_latest_container_tag_forbidden`);
}

function benchmarkLockReasons(candidate) {
  const reasons = [];
  if (candidate.status !== "benchmark_locked") reasons.push("status_not_benchmark_locked");

  const runtimes = [candidate.runtime?.primary, candidate.runtime?.secondary].filter(Boolean);
  for (const runtime of runtimes) {
    if (!EXACT_VERSION_RE.test(String(runtime.version ?? ""))) {
      reasons.push(`runtime_version_not_exact:${runtime.name ?? "unknown"}`);
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

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
