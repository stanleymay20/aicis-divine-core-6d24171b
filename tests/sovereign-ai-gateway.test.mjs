import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AICIS_SOVEREIGN_AI_POLICY_VERSION,
  AiSovereigntyPolicyError,
  evaluateAiRoute,
  parseSovereignHostAllowlist,
} from "../supabase/functions/_shared/ai-sovereignty.mjs";

function expectPolicyError(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error instanceof AiSovereigntyPolicyError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test("requires an explicit AI operating mode", () => {
  expectPolicyError(
    () => evaluateAiRoute({ endpoint: "http://127.0.0.1:8000/v1/chat/completions" }),
    "ai_mode_missing_or_invalid",
  );
});

test("rejects unknown AI operating modes", () => {
  expectPolicyError(
    () => evaluateAiRoute({ mode: "automatic", endpoint: "http://127.0.0.1:8000/v1/chat/completions" }),
    "ai_mode_missing_or_invalid",
  );
});

test("requires an explicit model endpoint", () => {
  expectPolicyError(
    () => evaluateAiRoute({ mode: "sovereign", endpoint: "" }),
    "model_endpoint_missing",
  );
});

test("permits loopback and RFC1918 endpoints in sovereign mode without an external fallback", () => {
  for (const endpoint of [
    "http://127.0.0.1:8000/v1/chat/completions",
    "http://10.10.0.5:8000/v1/chat/completions",
    "http://172.16.10.2:8000/v1/chat/completions",
    "http://192.168.1.4:8000/v1/chat/completions",
  ]) {
    const route = evaluateAiRoute({ mode: "sovereign", endpoint });
    assert.equal(route.policy_version, AICIS_SOVEREIGN_AI_POLICY_VERSION);
    assert.equal(route.mode, "sovereign");
    assert.equal(route.trust_class, "local_or_private");
    assert.equal(route.external_network_allowed, false);
  }
});

test("rejects an arbitrary public endpoint in sovereign mode", () => {
  expectPolicyError(
    () => evaluateAiRoute({
      mode: "sovereign",
      endpoint: "https://api.vendor.example/v1/chat/completions",
      apiKeyPresent: true,
    }),
    "external_endpoint_forbidden_in_sovereign_mode",
  );
});

test("requires authentication for an allowlisted public sovereign endpoint", () => {
  const sovereignHosts = parseSovereignHostAllowlist("models.aicis.example");
  expectPolicyError(
    () => evaluateAiRoute({
      mode: "sovereign",
      endpoint: "https://models.aicis.example/v1/chat/completions",
      sovereignHosts,
      apiKeyPresent: false,
    }),
    "public_sovereign_endpoint_requires_authentication",
  );

  const route = evaluateAiRoute({
    mode: "sovereign",
    endpoint: "https://models.aicis.example/v1/chat/completions",
    sovereignHosts,
    apiKeyPresent: true,
  });
  assert.equal(route.trust_class, "sovereign_allowlisted");
  assert.equal(route.external_network_allowed, false);
});

test("supports explicit wildcard sovereign host suffixes without matching the bare suffix", () => {
  const sovereignHosts = parseSovereignHostAllowlist("*.models.aicis.example");
  const route = evaluateAiRoute({
    mode: "sovereign",
    endpoint: "https://gpu-01.models.aicis.example/v1/chat/completions",
    sovereignHosts,
    apiKeyPresent: true,
  });
  assert.equal(route.trust_class, "sovereign_allowlisted");

  expectPolicyError(
    () => evaluateAiRoute({
      mode: "sovereign",
      endpoint: "https://models.aicis.example/v1/chat/completions",
      sovereignHosts,
      apiKeyPresent: true,
    }),
    "external_endpoint_forbidden_in_sovereign_mode",
  );
});

test("allows explicit external routing only in hybrid or research mode", () => {
  for (const mode of ["hybrid", "research"]) {
    const route = evaluateAiRoute({
      mode,
      endpoint: "https://api.vendor.example/v1/chat/completions",
    });
    assert.equal(route.mode, mode);
    assert.equal(route.trust_class, "external");
    assert.equal(route.external_network_allowed, true);
  }
});

test("forbids credentials embedded in the endpoint URL", () => {
  expectPolicyError(
    () => evaluateAiRoute({
      mode: "research",
      endpoint: "https://user:secret@api.vendor.example/v1/chat/completions",
    }),
    "model_endpoint_embedded_credentials_forbidden",
  );
});

test("gateway source contains no implicit OpenAI or GPT fallback", () => {
  const source = readFileSync("supabase/functions/_shared/ai-gateway.ts", "utf8");
  assert.equal(source.includes("api.openai.com"), false);
  assert.equal(source.includes("gpt-4o-mini"), false);
  assert.equal(source.includes("DEFAULT_ENDPOINT"), false);
  assert.equal(source.includes("DEFAULT_MODEL"), false);
  assert.match(source, /AICIS_AI_MODE/);
  assert.match(source, /AICIS_SOVEREIGN_MODEL_HOSTS/);
  assert.match(source, /evaluateAiRoute/);
});
