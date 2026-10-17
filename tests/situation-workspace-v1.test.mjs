import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Situations is a protected World workspace route", () => {
  const app = read("src/App.tsx");
  const workspaces = read("src/lib/aicis-workspaces.ts");
  const routeMap = read("docs/ux/AICIS_ROUTE_MIGRATION.md");
  const seo = read("src/lib/seo/registry.ts");

  assert.match(app, /const Situations = lazy\(\(\) => import\("\.\/pages\/Situations"\)\);/);
  assert.match(app, /<Route path="\/situations" element=\{<Shell><Situations \/><\/Shell>\} \/>/);
  assert.match(workspaces, /"\/situations"/);
  assert.match(routeMap, /^\/situations$/m);
  assert.match(seo, /"\/situations": \{ title: "Situations \| AICIS"/);
});

test("agent continuation contract requires Situation truth boundaries", () => {
  const agents = read("AGENTS.md");
  const situationContract = read("docs/SITUATION_READ_MODEL_V1.md");

  assert.match(agents, /docs\/SITUATION_READ_MODEL_V1\.md/);
  assert.match(agents, /do not infer independent corroboration from publisher\/source-identifier counts/i);
  assert.match(situationContract, /read-only projection/i);
  assert.match(situationContract, /Source identifiers are not independent corroboration/i);
  assert.match(situationContract, /operational outcome state.*not automatically a scientific forecast resolution/is);
  assert.match(situationContract, /forecast state is `not_linked`/i);
});

test("World makes the Situation queue discoverable", () => {
  const world = read("src/pages/WorldWorkspace.tsx");
  assert.match(world, /navigate\("\/situations"\)/);
  assert.match(world, />Situations<\/span>/);
});
