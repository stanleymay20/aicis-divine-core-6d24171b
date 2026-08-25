#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const baseUrl = process.env.AICIS_SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.AICIS_SERVICE_ROLE_KEY;
const outDir = process.argv[2] || "artifacts/aicis-storage";

if (!baseUrl) throw new Error("AICIS_SUPABASE_URL is required");
if (!serviceKey) throw new Error("AICIS_SERVICE_ROLE_KEY is required");

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}/storage/v1${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${body}`);
  }
  return response;
}

async function listAllObjects(bucketId, prefix = "") {
  const objects = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const response = await api(`/object/list/${encodeURIComponent(bucketId)}`, {
      method: "POST",
      body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Unexpected Storage list response for ${bucketId}`);
    objects.push(...page);
    if (page.length < limit) break;
    offset += page.length;
  }
  return objects;
}

function encodeObjectPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const bucketsResponse = await api("/bucket");
  const buckets = await bucketsResponse.json();
  if (!Array.isArray(buckets)) throw new Error("Unexpected Storage bucket response");

  const manifest = {
    created_utc: new Date().toISOString(),
    project_ref: "psonnnuhjjskrdazrakk",
    buckets: [],
  };

  for (const bucket of buckets) {
    const bucketId = bucket.id;
    const items = await listAllObjects(bucketId);
    const bucketManifest = { id: bucketId, public: Boolean(bucket.public), objects: [] };

    for (const item of items) {
      // Folder placeholders have no object metadata and are not downloadable objects.
      if (!item?.name || item.id == null) continue;
      const objectPath = item.name;
      const targetPath = join(outDir, "objects", bucketId, objectPath);
      await mkdir(dirname(targetPath), { recursive: true });

      const response = await api(
        `/object/authenticated/${encodeURIComponent(bucketId)}/${encodeObjectPath(objectPath)}`,
        { method: "GET", headers: { "Content-Type": "application/octet-stream" } },
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(targetPath, bytes);

      bucketManifest.objects.push({
        name: objectPath,
        bytes: bytes.length,
        updated_at: item.updated_at ?? null,
        metadata: item.metadata ?? null,
      });
    }

    manifest.buckets.push(bucketManifest);
  }

  await writeFile(join(outDir, "storage-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Backed up ${manifest.buckets.length} Storage buckets to ${outDir}`);
}

await main();
