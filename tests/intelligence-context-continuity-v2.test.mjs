import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const providerPath = new URL(
  "../src/contexts/IntelligenceOSContext.tsx",
  import.meta.url,
);

test("Rich intelligence entity context is session-scoped across shell remounts", async () => {
  const source = await readFile(providerPath, "utf8");

  assert.match(source, /ENTITY_SESSION_CACHE_KEY/);
  assert.match(source, /window\.sessionStorage\.getItem/);
  assert.match(source, /window\.sessionStorage\.setItem/);
  assert.match(source, /useState<Record<string, AICISEntity>>\(readSessionCache\)/);
  assert.match(source, /writeSessionCache\(nextCache\)/);
  assert.doesNotMatch(source, /window\.localStorage/);
});

test("Entity cache is bounded and validates stored objects before reuse", async () => {
  const source = await readFile(providerPath, "utf8");

  assert.match(source, /MAX_SESSION_ENTITIES = 20/);
  assert.match(source, /isEntity/);
  assert.match(source, /typeof entity\.id === "string"/);
  assert.match(source, /typeof entity\.type === "string"/);
  assert.match(source, /typeof entity\.name === "string"/);
  assert.match(source, /slice\(-MAX_SESSION_ENTITIES\)/);
});

test("URL entity state remains authoritative for shareable context", async () => {
  const source = await readFile(providerPath, "utf8");

  assert.match(source, /const entityParam = searchParams\.get\(ENTITY_PARAM\)/);
  assert.match(source, /entityCache\[entityParam\] \?\? parseEntity\(entityParam\)/);
  assert.match(source, /next\.set\(ENTITY_PARAM, key\)/);
  assert.match(source, /next\.delete\(ENTITY_PARAM\)/);
});
