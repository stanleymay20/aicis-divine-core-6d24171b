import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AICIS_SOVEREIGN_RUNTIME_CONTRACT_VERSION,
  assertBenchmarkLocked,
  evaluateSovereignRuntimeCandidate,
} from "../scripts/sovereign-runtime-contract.mjs";

function manifest() {
  return JSON.parse(readFileSync("config/aicis-sovereign-runtime-candidates-v1.json", "utf8"));
}

const SHA = "a".repeat(64);
const REV = "b".repeat(40);

function benchmarkLockedCandidate() {
  const candidate = manifest();
  candidate.status = "benchmark_locked";
  candidate.runtime.primary.version = "0.15.1";
  candidate.runtime.primary.container_digest = `sha256:${SHA}`;
  candidate.runtime.secondary.version = "0.5.3";
  candidate.runtime.secondary.container_digest = `sha256:${"c".repeat(64)}`;
  candidate.models = candidate.models.map((model, index) => ({
    ...model,
    revision: index === 0 ? REV : "d".repeat(40),
    weights_manifest_sha256: index === 0 ? SHA : "e".repeat(64),
    tokenizer_sha256: index === 0 ? "f".repeat(64) : "1".repeat(64),
    config_sha256: index === 0 ? "2".repeat(64) : "3".repeat(64),
  }));
  return candidate;
}

test("controlled manifest is research-admissible but not benchmark-locked", () => {
  const candidate = manifest();
  const result = evaluateSovereignRuntimeCandidate(candidate);
  assert.equal(candidate.contract_version, AICIS_SOVEREIGN_RUNTIME_CONTRACT_VERSION);
  assert.equal(result.admissible, true);
  assert.equal(result.benchmark_locked, false);
  assert.ok(result.benchmark_lock_reasons.includes("status_not_benchmark_locked"));
  assert.ok(result.benchmark_lock_reasons.some((reason) => reason.startsWith("runtime_version_unpinned:")));
  assert.ok(result.benchmark_lock_reasons.some((reason) => reason.startsWith("model_revision_unpinned:")));
});

test("manifest records Qwen candidates only as non-production research candidates", () => {
  const candidate = manifest();
  assert.deepEqual(candidate.models.map((model) => model.model_id), [
    "Qwen/Qwen3.8-27B",
    "Qwen/Qwen3.5-9B",
  ]);
  assert.equal(candidate.production_activation_allowed, false);
  assert.equal(candidate.external_model_fallback, false);
  assert.equal(candidate.models.every((model) => model.production_approved === false), true);
});

test("rejects external fallback and public model ingress", () => {
  const externalFallback = manifest();
  externalFallback.external_model_fallback = true;
  const fallbackResult = evaluateSovereignRuntimeCandidate(externalFallback);
  assert.equal(fallbackResult.admissible, false);
  assert.ok(fallbackResult.reasons.includes("external_model_fallback_forbidden"));

  const publicIngress = manifest();
  publicIngress.runtime.primary.public_ingress = true;
  publicIngress.network_policy.model_server_public_ingress = true;
  const ingressResult = evaluateSovereignRuntimeCandidate(publicIngress);
  assert.equal(ingressResult.admissible, false);
  assert.ok(ingressResult.reasons.includes("runtime_public_ingress_forbidden"));
  assert.ok(ingressResult.reasons.includes("model_server_public_ingress_forbidden"));
});

test("requires the vLLM reverse-proxy isolation boundary", () => {
  const candidate = manifest();
  candidate.runtime.primary.reverse_proxy_required = false;
  candidate.runtime.primary.deny_unproxied_inference_endpoints = false;
  const result = evaluateSovereignRuntimeCandidate(candidate);
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("vllm_reverse_proxy_required"));
  assert.ok(result.reasons.includes("vllm_unproxied_inference_must_be_denied"));
});

test("rejects mutable latest container references", () => {
  const candidate = manifest();
  candidate.runtime.primary.container_image = "vllm/vllm-openai:latest";
  const result = evaluateSovereignRuntimeCandidate(candidate);
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("mutable_latest_container_tag_forbidden"));
});

test("v1 contract cannot be used to assert production activation", () => {
  const candidate = manifest();
  candidate.production_activation_allowed = true;
  candidate.models[0].production_approved = true;
  const result = evaluateSovereignRuntimeCandidate(candidate);
  assert.equal(result.admissible, false);
  assert.ok(result.reasons.includes("production_activation_must_be_false_in_v1"));
  assert.ok(result.reasons.includes("model_production_approval_forbidden_in_v1"));
});

test("benchmark lock requires immutable runtime and model identities", () => {
  const candidate = benchmarkLockedCandidate();
  const result = evaluateSovereignRuntimeCandidate(candidate);
  assert.deepEqual(result, {
    admissible: true,
    benchmark_locked: true,
    reasons: [],
    benchmark_lock_reasons: [],
  });
});

test("benchmark lock rejects mutable runtime version labels", () => {
  for (const mutableVersion of ["latest", "main", "master", "nightly", "dev"]) {
    const candidate = benchmarkLockedCandidate();
    candidate.runtime.primary.version = mutableVersion;
    const result = evaluateSovereignRuntimeCandidate(candidate);
    assert.equal(result.admissible, true);
    assert.equal(result.benchmark_locked, false);
    assert.ok(result.benchmark_lock_reasons.includes("runtime_version_mutable:vllm"));
  }
});

test("benchmark lock fails closed on malformed digests or mutable identities", () => {
  const candidate = benchmarkLockedCandidate();
  candidate.runtime.primary.container_digest = "sha256:not-a-digest";
  candidate.models[0].revision = "main";
  candidate.models[0].tokenizer_sha256 = null;
  const result = evaluateSovereignRuntimeCandidate(candidate);
  assert.equal(result.admissible, true);
  assert.equal(result.benchmark_locked, false);
  assert.ok(result.benchmark_lock_reasons.includes("runtime_container_digest_unpinned:vllm"));
  assert.ok(result.benchmark_lock_reasons.includes("model_revision_unpinned:Qwen/Qwen3.8-27B"));
  assert.ok(result.benchmark_lock_reasons.includes("tokenizer_digest_unpinned:Qwen/Qwen3.8-27B"));
});

test("assertBenchmarkLocked deep-clones and recursively freezes the locked artifact", () => {
  const candidate = benchmarkLockedCandidate();
  const locked = assertBenchmarkLocked(candidate);
  assert.equal(Object.isFrozen(locked), true);
  assert.equal(Object.isFrozen(locked.runtime), true);
  assert.equal(Object.isFrozen(locked.runtime.primary), true);
  assert.equal(Object.isFrozen(locked.models), true);
  assert.equal(Object.isFrozen(locked.models[0]), true);

  candidate.models[0].model_id = "mutated/model";
  assert.equal(locked.models[0].model_id, "Qwen/Qwen3.8-27B");
});

test("assertBenchmarkLocked refuses the unpinned research manifest", () => {
  assert.throws(
    () => assertBenchmarkLocked(manifest()),
    (error) => {
      assert.equal(error.code, "AICIS_SOVEREIGN_RUNTIME_NOT_BENCHMARK_LOCKED");
      assert.ok(error.reasons.includes("status_not_benchmark_locked"));
      return true;
    },
  );
});
