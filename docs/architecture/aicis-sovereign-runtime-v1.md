# AICIS Sovereign AI Runtime v1

Status: controlled research architecture candidate. No GPU runtime is provisioned by this change, no model is production-approved, and no production traffic is routed to these candidates.

Contract: `aicis-sovereign-runtime-contract-v1`

Research checkpoint: 2026-09-04

## Purpose

Sovereign AI Gateway v1 established the model-routing trust boundary. Runtime v1 defines how an AICIS-controlled inference service may enter a reproducible benchmark without turning a model name, mutable image tag, or vendor benchmark into production evidence.

The governing invariant remains:

> AICIS must remain capable of performing its core intelligence functions with third-party LLM APIs disconnected.

The LLM is not the authoritative world state, forecast ledger, ground truth, calibration record, causal engine, or scientific evaluator. Those remain separate AICIS systems.

## Research selection

### Primary serving candidate: vLLM

vLLM is the primary benchmark runtime because it exposes an OpenAI-compatible HTTP interface that fits the AICIS shared gateway and supports current Qwen models.

A security caveat is material: current vLLM documentation states that its built-in API-key protection does not cover every server endpoint and specifically warns operators not to rely on the API key alone. Therefore AICIS Runtime v1 requires:

- a private or loopback model-server network boundary;
- no public model-server ingress;
- a reverse proxy or equivalent network enforcement point between the AICIS gateway and vLLM;
- denial of unproxied inference-capable endpoints;
- deny-by-default model-server egress;
- immutable runtime/container identity before a benchmark is called reproducible.

Reference: https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/

### Secondary serving candidate: SGLang

SGLang is retained as a benchmark alternative, not an automatic fallback. Its current documentation exposes an OpenAI-compatible API and provides serving benchmarks covering throughput, time-to-first-token, inter-token latency, and end-to-end latency. This makes it useful for a controlled serving-engine comparison without changing AICIS application call sites.

References:

- https://github.com/sgl-project/sglang/blob/main/docs/docs/get-started/quickstart.mdx
- https://github.com/sgl-project/sglang/blob/main/docs/docs/developer_guide/bench_serving.mdx

No request may silently fail over from vLLM to SGLang. Runtime choice must be explicit and recorded.

## Model candidates

### Primary quality candidate: `Qwen/Qwen3.8-27B`

Research evidence checked on 2026-09-04 records:

- Apache-2.0 declared license;
- approximately 27.8B parameters;
- native multimodal capability;
- 262,144-token native context in the published model card;
- stated compatibility with vLLM and SGLang.

References:

- https://huggingface.co/Qwen/Qwen3.8-27B
- https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/LICENSE

This is a benchmark candidate, not a quality claim. Published benchmark tables are not sufficient to promote it inside AICIS.

### Smoke/efficiency candidate: `Qwen/Qwen3.5-9B`

Research evidence checked on 2026-09-04 records:

- Apache-2.0 declared license;
- approximately 9.65B parameters;
- multimodal capability;
- stated compatibility with vLLM and SGLang.

References:

- https://huggingface.co/Qwen/Qwen3.5-9B
- https://huggingface.co/Qwen/Qwen3.5-9B/blob/main/LICENSE

Its role is lower-cost smoke testing, integration testing, and efficiency comparison. It is not designated as an automatic fallback for the 27B candidate.

## Why the model revision is intentionally not pinned yet

The repository manifest records model IDs but leaves `revision` and artifact digests null while status is `research_candidate`.

That is deliberate. A model is benchmark-locked only after AICIS captures the exact downloaded artifact set and records:

- immutable Hugging Face revision/commit;
- SHA-256 of the local weight-file manifest;
- tokenizer SHA-256;
- config SHA-256;
- exact runtime version;
- immutable container image digest.

Using `main`, `latest`, a model display name, or a mutable container tag as reproducibility evidence is forbidden.

## Runtime states

### `research_candidate`

May describe a candidate architecture and model family. It is not reproducible enough for a controlled benchmark and cannot be treated as deployed.

### `benchmark_locked`

Requires immutable runtime and model identities. The contract rejects benchmark-lock claims unless all required digests and revisions are present and correctly formed.

Runtime v1 has no production-active state. `production_activation_allowed` and every model's `production_approved` field must remain `false`.

## Benchmark gate

A locked runtime should be tested against AICIS task fixtures rather than promoted from vendor claims. Required evaluation dimensions are:

1. structured-output validity;
2. grounded task accuracy;
3. unsupported-assertion rate;
4. abstention behavior;
5. prompt-injection resistance;
6. latency;
7. throughput;
8. memory footprint;
9. failure recovery.

A deterministic baseline is mandatory. A frontier API may be used as an optional research reference, but it is not authoritative and cannot create an automatic promotion path.

LLM output must not be presented as a scientifically calibrated forecast merely because the model can generate a probability or confidence value. Scientific forecasts remain governed by the separate AICIS forecasting protocol and immutable forecast ledgers.

## Network layout

```text
AICIS Edge Functions
        |
        v
Sovereign AI Gateway
        |
        v
private authenticated proxy / policy boundary
        |
        v
pinned inference runtime
        |
        v
pinned model artifacts
```

The inference runtime is not exposed directly to the public internet. The model server has deny-by-default egress. Redirect-following remains forbidden at the gateway.

## First benchmark sequence

1. Choose an isolated GPU host only after cost and ownership are explicit.
2. Download candidate artifacts without changing AICIS production.
3. Generate and independently verify the artifact SHA-256 manifest.
4. Pin the model revision, tokenizer/config digests, runtime version, and container digest in a benchmark-specific manifest.
5. Run smoke tests with the 9B candidate.
6. Run the controlled task suite with the 27B candidate.
7. Compare vLLM and SGLang only if serving-engine evidence is needed.
8. Record latency, throughput, memory and failure behavior together with task-quality evidence.
9. Keep external LLM APIs disconnected during the sovereign-path acceptance exercise.
10. Do not promote any model until a separate production decision and acceptance gate exists.

## Explicit non-claims

Runtime v1 does not claim that:

- AICIS currently has a self-hosted GPU service;
- Qwen3.8-27B is the best model for AICIS;
- Qwen3.5-9B meets production quality;
- vLLM or SGLang is production-secured merely by default configuration;
- model weights have already been cryptographically pinned;
- AICIS is fully sovereign from every infrastructure dependency;
- the historical Lovable/Supabase migration is complete.
