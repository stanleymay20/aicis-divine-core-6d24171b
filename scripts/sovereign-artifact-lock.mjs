import { createHash } from "node:crypto";
import { lstat, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const AICIS_SOVEREIGN_ARTIFACT_LOCK_VERSION = "aicis-sovereign-artifact-lock-v1";

const REVISION_RE = /^[a-f0-9]{40}$/i;
const WEIGHT_FILE_RE = /\.(?:safetensors|gguf|bin)$/i;
const IGNORED_DIRS = new Set([".git", ".cache"]);

export class SovereignArtifactLockError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "SovereignArtifactLockError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export async function buildArtifactLock({ rootDir, modelId, revision }) {
  if (!modelId || typeof modelId !== "string" || !modelId.trim()) {
    throw new SovereignArtifactLockError("modelId is required", "model_id_missing");
  }
  if (!REVISION_RE.test(String(revision ?? ""))) {
    throw new SovereignArtifactLockError(
      "revision must be an immutable 40-hex repository commit",
      "model_revision_not_immutable",
    );
  }

  const root = resolve(String(rootDir ?? ""));
  let rootStats;
  try {
    rootStats = await stat(root);
  } catch {
    throw new SovereignArtifactLockError("artifact root does not exist", "artifact_root_missing");
  }
  if (!rootStats.isDirectory()) {
    throw new SovereignArtifactLockError("artifact root must be a directory", "artifact_root_not_directory");
  }

  const paths = await collectRegularFiles(root, root);
  if (paths.length === 0) {
    throw new SovereignArtifactLockError("artifact root contains no files", "artifact_files_missing");
  }

  const files = [];
  for (const item of paths) {
    const fileStats = await stat(item.absolutePath);
    const sha256 = await sha256File(item.absolutePath);
    files.push(Object.freeze({
      path: item.relativePath,
      bytes: fileStats.size,
      sha256,
    }));
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const config = files.find((file) => file.path === "config.json");
  if (!config) {
    throw new SovereignArtifactLockError("config.json is required", "config_artifact_missing");
  }

  const tokenizer = files.find((file) => file.path === "tokenizer.json");
  if (!tokenizer) {
    throw new SovereignArtifactLockError("tokenizer.json is required", "tokenizer_artifact_missing");
  }

  const weightFiles = files.filter((file) => WEIGHT_FILE_RE.test(file.path));
  if (weightFiles.length === 0) {
    throw new SovereignArtifactLockError(
      "at least one recognized model weight artifact is required",
      "weight_artifacts_missing",
    );
  }

  const weightsManifestPayload = weightFiles
    .map((file) => `${file.path}\t${file.bytes}\t${file.sha256}`)
    .join("\n");
  const weightsManifestSha256 = sha256Text(weightsManifestPayload);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

  const body = {
    lock_version: AICIS_SOVEREIGN_ARTIFACT_LOCK_VERSION,
    model_id: modelId.trim(),
    revision: String(revision).toLowerCase(),
    file_count: files.length,
    total_bytes: totalBytes,
    weight_file_count: weightFiles.length,
    weights_manifest_sha256: weightsManifestSha256,
    config_sha256: config.sha256,
    tokenizer_sha256: tokenizer.sha256,
    files,
  };

  const manifestSha256 = sha256Text(canonicalJson(body));
  return deepFreeze({ ...body, manifest_sha256: manifestSha256 });
}

export async function writeArtifactLock({ rootDir, modelId, revision, outputPath }) {
  const root = resolve(String(rootDir ?? ""));
  const output = resolve(String(outputPath ?? ""));
  if (!outputPath) {
    throw new SovereignArtifactLockError("outputPath is required", "output_path_missing");
  }

  const outputRelative = relative(root, output);
  const outputInsideRoot = outputRelative === "" || (
    outputRelative !== ".." &&
    !outputRelative.startsWith(`..${sep}`) &&
    !isAbsolute(outputRelative)
  );
  if (outputInsideRoot) {
    throw new SovereignArtifactLockError(
      "artifact lock output must be outside the hashed artifact root",
      "output_inside_artifact_root_forbidden",
    );
  }

  const lock = await buildArtifactLock({ rootDir: root, modelId, revision });
  await writeFile(output, `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return lock;
}

async function collectRegularFiles(root, current) {
  const entries = await readdir(current, { withFileTypes: true });
  const output = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const absolutePath = resolve(current, entry.name);
    const metadata = await lstat(absolutePath);

    if (metadata.isSymbolicLink()) {
      throw new SovereignArtifactLockError(
        "symbolic links are forbidden in materialized model artifacts",
        "artifact_symlink_forbidden",
        { path: toPortableRelative(root, absolutePath) },
      );
    }
    if (metadata.isDirectory()) {
      output.push(...await collectRegularFiles(root, absolutePath));
      continue;
    }
    if (!metadata.isFile()) {
      throw new SovereignArtifactLockError(
        "unsupported filesystem entry in artifact root",
        "artifact_entry_type_forbidden",
        { path: toPortableRelative(root, absolutePath) },
      );
    }

    output.push({
      absolutePath,
      relativePath: toPortableRelative(root, absolutePath),
    });
  }

  return output;
}

function toPortableRelative(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new SovereignArtifactLockError(`missing value for --${key}`, "cli_argument_value_missing");
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const lock = await writeArtifactLock({
    rootDir: args.root,
    modelId: args["model-id"],
    revision: args.revision,
    outputPath: args.output,
  });
  console.log(JSON.stringify({
    lock_version: lock.lock_version,
    model_id: lock.model_id,
    revision: lock.revision,
    file_count: lock.file_count,
    total_bytes: lock.total_bytes,
    manifest_sha256: lock.manifest_sha256,
    output: basename(resolve(args.output)),
  }));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    const payload = {
      ok: false,
      code: error?.code ?? "artifact_lock_failed",
      error: error instanceof Error ? error.message : String(error),
    };
    console.error(JSON.stringify(payload));
    process.exitCode = 1;
  });
}
