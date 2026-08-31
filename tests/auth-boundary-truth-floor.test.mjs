import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const protectedRoutePath = new URL("../src/components/auth/ProtectedRoute.tsx", import.meta.url);
const authPagePath = new URL("../src/pages/Auth.tsx", import.meta.url);
const authProviderPath = new URL("../src/components/auth/AuthProvider.tsx", import.meta.url);
const resetPath = new URL("../src/pages/ResetPassword.tsx", import.meta.url);
const sharedAuthPath = new URL("../supabase/functions/_shared/auth.ts", import.meta.url);
const crisisScanPath = new URL("../supabase/functions/crisis-scan/index.ts", import.meta.url);
const adiAnalyzePath = new URL("../supabase/functions/adi-analyze/index.ts", import.meta.url);

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
  assert.match(source, /containsControlCharacter\(value\)/);
});

test("password recovery requires a recovery-bearing validated session and closes it after reset", async () => {
  const source = await readFile(resetPath, "utf8");

  assert.match(source, /PASSWORD_RECOVERY/);
  assert.match(source, /carriesRecoveryIntent/);
  assert.match(source, /getSession\(\)/);
  assert.match(source, /signOut\(\{ scope: "global" \}\)/);
  assert.match(source, /MIN_NEW_PASSWORD_LENGTH = 12/);
});

test("trusted worker secrets are compared exactly, never by substring", async () => {
  const source = await readFile(sharedAuthPath, "utf8");

  assert.match(source, /providedCron === expectedCron/);
  assert.match(source, /provided === expected/);
  assert.doesNotMatch(source, /\.includes\(expected/);
});

test("crisis-scan cannot turn missing authorization into a privileged system call", async () => {
  const source = await readFile(crisisScanPath, "utf8");

  assert.match(source, /requireAdminOrTrustedWorker\(req\)/);
  assert.doesNotMatch(source, /isSystemCall\s*=\s*[^;\n]*!\s*authHeader/i);
  assert.doesNotMatch(source, /authHeader\s*\.\s*includes\s*\(\s*(?:serviceRoleKey|anonKey)/i);
});

test("ADI requires a real user or an exact trusted-worker credential before service-role access", async () => {
  const source = await readFile(adiAnalyzePath, "utf8");

  assert.match(source, /requireUserOrTrustedWorker\(req, corsHeaders\)/);
  assert.match(source, /if \(auth\.response\) return auth\.response/);
  assert.doesNotMatch(source, /authHeader\s*\.\s*includes\s*\(\s*serviceRoleKey/i);
  assert.doesNotMatch(source, /if \(authHeader && !isServiceRoleCall\)/);
});
