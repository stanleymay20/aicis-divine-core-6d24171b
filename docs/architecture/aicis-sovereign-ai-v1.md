# AICIS Sovereign AI Architecture v1

Status: controlled architecture candidate. This document does not assert that a sovereign model endpoint is deployed or production-validated.

Policy version: `aicis-sovereign-ai-policy-v1`

## Objective

AICIS may use external frontier models, but no external LLM provider may become a single point of dependency for AICIS data, memory, reasoning, forecasting, or continued operation.

The target operating invariant is:

> AICIS must remain capable of performing its core intelligence functions with all third-party LLM APIs disconnected.

This does not mean every AICIS capability must be implemented by a single self-hosted LLM. Forecasting models, deterministic rules, temporal state, provenance, evaluation, knowledge-time controls, and scientific ledgers remain independent of the LLM layer.

## Trust boundary

The authoritative AICIS state remains outside the LLM:

```text
Evidence / observations
        |
        v
Bitemporal world state + provenance
        |
        v
Forecasting / specialist models
        |
        v
Knowledge graph + scientific ledgers
        |
        v
AICIS model gateway
        |
        +--> sovereign model endpoint
        +--> external endpoint only when mode explicitly permits it
```

Replacing the active LLM must not erase or redefine AICIS historical evidence, forecasts, ground truth, calibration history, or model evaluation records.

## Operating modes

### `sovereign`

- Default target for protected production intelligence workloads.
- Third-party public model endpoints are forbidden.
- Model endpoint must be local/private or explicitly present in `AICIS_SOVEREIGN_MODEL_HOSTS`.
- A public allowlisted sovereign endpoint must have API authentication configured.
- There is no silent fallback to an external model if the sovereign endpoint fails.
- Failure to satisfy the route policy fails closed.

### `hybrid`

- AICIS-controlled intelligence remains authoritative.
- An explicitly configured external model endpoint may be used.
- Sensitive-context minimization/redaction is a separate application responsibility and must be designed before production use of external providers.
- Hybrid mode is not equivalent to sovereign mode.

### `research`

- Used for controlled model comparisons, evaluations, and experiments.
- External endpoints may be configured explicitly.
- Research results do not automatically promote a provider or model to production.
- Scientific claims remain governed by AICIS evaluation protocols, not vendor benchmark claims.

## Gateway configuration

All routing is explicit. The gateway has no built-in external provider endpoint and no built-in model identifier.

Required:

- `AICIS_AI_MODE`
- `AICIS_MODEL_ENDPOINT`
- `AICIS_MODEL_NAME`

Optional/conditional:

- `AICIS_MODEL_PROVIDER` — telemetry label only.
- `AICIS_MODEL_API_KEY` — required for public sovereign endpoints; optional for local/private development endpoints.
- `AICIS_SOVEREIGN_MODEL_HOSTS` — comma-separated exact hosts or wildcard suffixes that AICIS operators explicitly control and approve.

Secrets belong in server-side secret storage. They must not be placed in Vite/browser variables or returned in gateway route telemetry.

## Provider-neutral interface

AICIS Edge Functions call the shared `aiChat()` gateway rather than provider-specific SDKs. The current transport is deliberately OpenAI-compatible HTTP because multiple self-hosted and hosted runtimes can implement that wire shape.

OpenAI-compatible describes the API contract only. It does not imply OpenAI is the provider or default.

The application callsite must not change when operators change the configured compatible backend.

## Fail-closed requirements

The v1 gateway rejects:

1. missing or unknown `AICIS_AI_MODE`;
2. missing or malformed model endpoint;
3. non-HTTP(S) model endpoints;
4. credentials embedded in endpoint URLs;
5. link-local and known cloud metadata targets in every mode;
6. arbitrary public endpoints in `sovereign` mode;
7. public sovereign endpoints that are allowlisted but unauthenticated;
8. missing explicit model names.

A sovereign request must never be automatically retried against a third-party endpoint.

## Telemetry

A successful gateway response exposes non-secret route metadata:

- sovereignty policy version;
- operating mode;
- endpoint hostname;
- protocol;
- trust class;
- whether the selected mode permits external network routing.

API keys and endpoint credentials are excluded.

This metadata is intended to support later audit ledgers proving which model trust boundary handled a result.

## What v1 does not claim

This change does not claim that:

- a sovereign GPU runtime has been provisioned;
- AICIS is currently independent of every external service;
- any open-weight model has passed AICIS quality/calibration gates;
- confidential-computing guarantees are active;
- the current Supabase/Lovable migration is complete.

Those require separate evidence and acceptance gates.

## Next controlled phases

1. Provision an isolated AICIS-controlled OpenAI-compatible inference endpoint.
2. Pin model identity, weights digest, tokenizer/config digest, container digest, and runtime version.
3. Add health/readiness checks without silent external fallback.
4. Build a sovereign model evaluation tournament against deterministic baselines and optional frontier references.
5. Add immutable inference provenance records with prompt/template version, model digest, route trust class, and evidence references.
6. Add private embedding support behind the same sovereignty policy.
7. Prove an offline/no-third-party-LLM operating exercise before making a sovereignty claim.
