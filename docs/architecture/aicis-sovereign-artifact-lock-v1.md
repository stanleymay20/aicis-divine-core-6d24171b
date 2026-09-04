# AICIS Sovereign Artifact Lock v1

Status: controlled integrity tooling. This does not download model weights, prove model quality, or authorize production activation.

Lock version: `aicis-sovereign-artifact-lock-v1`

## Purpose

Sovereign Runtime v1 requires a benchmark to identify the exact runtime and model artifacts used. A model name such as `Qwen/Qwen3.8-27B`, a mutable branch such as `main`, or a container tag such as `latest` is not reproducibility evidence.

Artifact Lock v1 turns a fully materialized local model directory into deterministic SHA-256 evidence that can populate the runtime benchmark-lock contract.

## Required inputs

The operator must provide:

- a materialized local artifact directory;
- the exact model repository identifier;
- an immutable 40-hex repository revision/commit;
- an output path outside the artifact directory.

The artifact directory must include:

- `config.json`;
- `tokenizer.json`;
- at least one recognized model-weight artifact ending in `.safetensors`, `.gguf`, or `.bin`.

All regular files under the artifact root are hashed, except download/VCS metadata directories named `.cache` and `.git`. This means license files, chat templates, generation configuration, processor configuration, model indexes, and other shipped artifacts become part of the whole-manifest identity when present.

## Symlink policy

Symbolic links are rejected.

The benchmark evidence should describe the bytes actually materialized for execution, not a directory whose apparent files may resolve elsewhere. If the model downloader creates a symlink-based cache snapshot, materialize/copy the intended snapshot into a dedicated benchmark artifact directory before creating the lock.

## Output

The generated JSON contains:

- lock contract version;
- model ID;
- immutable revision;
- file count and total bytes;
- per-file relative path, byte count, and SHA-256;
- weight-file count;
- `weights_manifest_sha256` calculated from the canonical ordered weight-file records;
- `config_sha256`;
- `tokenizer_sha256`;
- `manifest_sha256` calculated from the complete canonical lock body.

No timestamp is included in the hashed body. The same model ID, revision, and identical materialized bytes should therefore yield the same lock digest regardless of download time or local directory name.

## CLI

Example:

```bash
node scripts/sovereign-artifact-lock.mjs \
  --root /secure/aicis/models/qwen-candidate \
  --model-id Qwen/Qwen3.8-27B \
  --revision <40-hex-commit> \
  --output /secure/aicis/locks/qwen3.8-27b.lock.json
```

The output file must be outside the artifact root and is created with no-overwrite semantics. An existing lock file is never silently replaced.

## Relationship to Runtime v1

A Runtime v1 candidate cannot become `benchmark_locked` until its manifest records:

- exact runtime version;
- immutable runtime container SHA-256 digest;
- exact model revision;
- `weights_manifest_sha256`;
- `config_sha256`;
- `tokenizer_sha256`.

Artifact Lock v1 supplies the model-side digests. Runtime/container identity must be captured separately from the actual runtime image that will execute the benchmark.

## What the lock proves

When generated on a controlled host, the lock provides reproducible evidence of the local file set and its contents at hashing time. It can detect subsequent byte changes and can be independently regenerated from the same materialized artifacts.

## What the lock does not prove

It does not by itself prove:

- that the repository owner is trustworthy;
- that the declared model license is legally sufficient for every use;
- that the downloaded artifacts are free of malicious code or unsafe model behavior;
- that the model has passed AICIS quality, security, calibration, or prompt-injection tests;
- that a benchmark process actually loaded the locked files;
- that a GPU host or container is sovereign;
- that AICIS is production-ready.

The later benchmark harness must bind each run to this artifact-lock digest and the pinned runtime/container identity.

## Acceptance sequence

1. Obtain the exact upstream repository revision from the authoritative model source.
2. Materialize the model snapshot into an isolated directory.
3. Generate Artifact Lock v1 outside that directory.
4. Regenerate the lock independently and compare `manifest_sha256`.
5. Record the lock evidence in the benchmark candidate manifest.
6. Pin the serving runtime version and container digest.
7. Only then mark the candidate `benchmark_locked`.
8. Execute the AICIS evaluation suite with no automatic model fallback or promotion.
