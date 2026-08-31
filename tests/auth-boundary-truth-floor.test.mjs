import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protectedRoutePath = new URL("../src/components/auth/ProtectedRoute.tsx", import.meta.url);
const authPagePath = new URL("../src/pages/Auth.tsx", import.meta.url);
const authProviderPath = new URL("../src/hooks/useAuth.tsx", import.meta.url);
const resetPath = new URL("../src/pages/ResetPassword.tsx", import.meta.url);

test("demo mode can never substitute for authentication", async () => {
  const source = await readFile(protectedRoutePath, "utf8");

  assert.match(source, /if \(!user\) \{/);
  assert.doesNotMatch(source, /!user\s*&&\s*!isDemo/);
  assert.doesNotMatch(source, /if \(needsRoleCheck && isDemo\)/);
  assert.match(source, /Authentication is an absolute boundary/);
});

test("initial persisted sessions are server-verified before protected UI unlocks", async () => {
  const source = await readFile(authProviderPath, "utf8");

  assert.match(source, /getUser\(candidate\.access_token\)/);
  assert.match(source, /event === "INITIAL_SESSION"/);
  assert.match(source, /validateInitialSession\(nextSession\)/);
  assert.match(source, /signOut\(\{ scope: "local" \}\)/);
});

test("frontend OAuth uses the configured Supabase auth provider, not Lovable auth", async () => {
  const source = await readFile(authPagePath, "utf8");

  assert.match(source, /supabase\.auth\.signInWithOAuth/);
  assert.match(source, /provider: "google"/);
  assert.doesNotMatch(source, /@\/integrations\/lovable/);
  assert.doesNotMatch(source, /lovable\.auth/);
});

test("auth redirects fail to the World workspace and reject suspicious external-looking paths", async () => {
  const source = await readFile(authPagePath, "utf8");

  assert.match(source, /return "\/world"/);
  assert.match(source, /value\.startsWith\("\/\/"\)/);
  assert.match(source, /value\.includes\("\\\\"\)/);
});

test("password recovery requires a recovery-bearing validated session and closes it after reset", async () => {
  const source = await readFile(resetPath, "utf8");

  assert.match(source, /PASSWORD_RECOVERY/);
  assert.match(source, /carriesRecoveryIntent/);
  assert.match(source, /getSession\(\)/);
  assert.match(source, /signOut\(\{ scope: "global" \}\)/);
  assert.match(source, /MIN_NEW_PASSWORD_LENGTH = 12/);
});
