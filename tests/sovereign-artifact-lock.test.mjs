import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  AICIS_SOVEREIGN_ARTIFACT_LOCK_VERSION,
  SovereignArtifactLockError,
  buildArtifactLock,
  writeArtifactLock,
} from "../scripts/sovereign-artifact-lock.mjs";

const REVISION = "a".repeat(40);
const MODEL_ID = "Qwen/test-fixture";

async function fixtureRoot(parent, name, order = ["config", "tokenizer", "weight", "readme"]) {
  const root = join(parent, name);
  await mkdir(root, { recursive: true });
  const contents = {
    config: ["config.json", '{"model_type":"test"}\n'],
    tokenizer: ["tokenizer.json", '{"tokens":["a","b"]}\n'],
    weight: ["model-00001-of-00001.safetensors", "fixture-weight-bytes"],
    readme: ["README.md", "fixture only\n"],
  };
  for (const key of order) {
    const [path, content] = contents[key];
    await writeFile(join(root, path), content);
  }
  return root;
}

async function withTemp(testFn) {
  const parent = await mkdtemp(join(tmpdir(), "aicis-artifact-lock-"));
  try {
    await testFn(parent);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function expectLockError(error, code) {
  assert.equal(error instanceof SovereignArtifactLockError, true);
  assert.equal(error.code, code);
  return true;
}

test("builds a deterministic lock from materialized model artifacts", async () => {
  await withTemp(async (parent) => {
    const rootA = await fixtureRoot(parent, "a", ["weight", "readme", "tokenizer", "config"]);
    const rootB = await fixtureRoot(parent, "b", ["config", "tokenizer", "readme", "weight"]);

    const lockA = await buildArtifactLock({ rootDir: rootA, modelId: MODEL_ID, revision: REVISION });
    const lockB = await buildArtifactLock({ rootDir: rootB, modelId: MODEL_ID, revision: REVISION.toUpperCase() });

    assert.equal(lockA.lock_version, AICIS_SOVEREIGN_ARTIFACT_LOCK_VERSION);
    assert.equal(lockA.model_id, MODEL_ID);
    assert.equal(lockA.revision, REVISION);
    assert.equal(lockA.file_count, 4);
    assert.equal(lockA.weight_file_count, 1);
    assert.equal(lockA.manifest_sha256, lockB.manifest_sha256);
    assert.equal(lockA.weights_manifest_sha256, lockB.weights_manifest_sha256);
    assert.deepEqual(lockA.files, lockB.files);
    assert.equal(lockA.config_sha256, digest('{"model_type":"test"}\n'));
    assert.equal(lockA.tokenizer_sha256, digest('{"tokens":["a","b"]}\n'));
    assert.match(lockA.manifest_sha256, /^[a-f0-9]{64}$/);
    assert.match(lockA.weights_manifest_sha256, /^[a-f0-9]{64}$/);
  });
});

test("weight mutation changes the weight and whole-manifest identities", async () => {
  await withTemp(async (parent) => {
    const root = await fixtureRoot(parent, "model");
    const before = await buildArtifactLock({ rootDir: root, modelId: MODEL_ID, revision: REVISION });

    await writeFile(join(root, "model-00001-of-00001.safetensors"), "changed-weight-bytes");
    const after = await buildArtifactLock({ rootDir: root, modelId: MODEL_ID, revision: REVISION });

    assert.notEqual(before.weights_manifest_sha256, after.weights_manifest_sha256);
    assert.notEqual(before.manifest_sha256, after.manifest_sha256);
    assert.equal(before.config_sha256, after.config_sha256);
    assert.equal(before.tokenizer_sha256, after.tokenizer_sha256);
  });
});

test("ignored cache metadata cannot alter artifact identity", async () => {
  await withTemp(async (parent) => {
    const root = await fixtureRoot(parent, "model");
    const before = await buildArtifactLock({ rootDir: root, modelId: MODEL_ID, revision: REVISION });

    await mkdir(join(root, ".cache", "huggingface"), { recursive: true });
    await writeFile(join(root, ".cache", "huggingface", "metadata.json"), "changing-download-metadata");
    const after = await buildArtifactLock({ rootDir: root, modelId: MODEL_ID, revision: REVISION });

    assert.equal(before.manifest_sha256, after.manifest_sha256);
    assert.equal(after.files.some((file) => file.path.startsWith(".cache/")), false);
  });
});

test("requires explicit root, model id and immutable revision", async () => {
  await withTemp(async (parent) => {
    const root = await fixtureRoot(parent, "model");

    await assert.rejects(
      buildArtifactLock({ rootDir: "", modelId: MODEL_ID, revision: REVISION }),
      (error) => expectLockError(error, "artifact_root_missing"),
    );
    await assert.rejects(
      buildArtifactLock({ rootDir: root, modelId: "", revision: REVISION }),
      (error) => expectLockError(error, "model_id_missing"),
    );
    await assert.rejects(
      buildArtifactLock({ rootDir: root, modelId: MODEL_ID, revision: "main" }),
      (error) => expectLockError(error, "model_revision_not_immutable"),
    );
  });
});

test("fails closed when required config, tokenizer or weight artifacts are absent", async () => {
  await withTemp(async (parent) => {
    const missingConfig = join(parent, "missing-config");
    await mkdir(missingConfig);
    await writeFile(join(missingConfig, "tokenizer.json"), "{}");
    await writeFile(join(missingConfig, "model.safetensors"), "weights");
    await assert.rejects(
      buildArtifactLock({ rootDir: missingConfig, modelId: MODEL_ID, revision: REVISION }),
      (error) => expectLockError(error, "config_artifact_missing"),
    );

    const missingTokenizer = join(parent, "missing-tokenizer");
    await mkdir(missingTokenizer);
    await writeFile(join(missingTokenizer, "config.json"), "{}");
    await writeFile(join(missingTokenizer, "model.safetensors"), "weights");
    await assert.rejects(
      buildArtifactLock({ rootDir: missingTokenizer, modelId: MODEL_ID, revision: REVISION }),
      (error) => expectLockError(error, "tokenizer_artifact_missing"),
    );

    const missingWeights = join(parent, "missing-weights");
    await mkdir(missingWeights);
    await writeFile(join(missingWeights, "config.json"), "{}");
    await writeFile(join(missingWeights, "tokenizer.json"), "{}");
    await assert.rejects(
      buildArtifactLock({ rootDir: missingWeights, modelId: MODEL_ID, revision: REVISION }),
      (error) => expectLockError(error, "weight_artifacts_missing"),
    );
  });
});

test("rejects symbolic links instead of hashing files outside the materialized artifact root", async () => {
  await withTemp(async (parent) => {
    const root = await fixtureRoot(parent, "model");
    const outside = join(parent, "outside-secret.safetensors");
    await writeFile(outside, "not-part-of-model");
    await symlink(outside, join(root, "linked-weight.safetensors"));

    await assert.rejects(
      buildArtifactLock({ rootDir: root, modelId: MODEL_ID, revision: REVISION }),
      (error) => expectLockError(error, "artifact_symlink_forbidden"),
    );
  });
});

test("writes the lock outside the artifact tree and refuses overwrite", async () => {
  await withTemp(async (parent) => {
    const root = await fixtureRoot(parent, "model");
    const output = join(parent, "artifact-lock.json");

    const lock = await writeArtifactLock({ rootDir: root, modelId: MODEL_ID, revision: REVISION, outputPath: output });
    const persisted = JSON.parse(await readFile(output, "utf8"));
    assert.equal(persisted.manifest_sha256, lock.manifest_sha256);

    await assert.rejects(
      writeArtifactLock({ rootDir: root, modelId: MODEL_ID, revision: REVISION, outputPath: output }),
      (error) => expectLockError(error, "output_already_exists"),
    );

    await assert.rejects(
      writeArtifactLock({
        rootDir: root,
        modelId: MODEL_ID,
        revision: REVISION,
        outputPath: join(root, "artifact-lock.json"),
      }),
      (error) => expectLockError(error, "output_inside_artifact_root_forbidden"),
    );
  });
});

test("returned lock is recursively immutable", async () => {
  await withTemp(async (parent) => {
    const root = await fixtureRoot(parent, "model");
    const lock = await buildArtifactLock({ rootDir: root, modelId: MODEL_ID, revision: REVISION });
    assert.equal(Object.isFrozen(lock), true);
    assert.equal(Object.isFrozen(lock.files), true);
    assert.equal(Object.isFrozen(lock.files[0]), true);
  });
});
