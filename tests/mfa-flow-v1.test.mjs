import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveMfaState, isValidTotpCode, needsMfaChallenge, safeMfaNext, staleUnverifiedFactorIds } from "../src/lib/mfa-state.mjs";

test("AAL1 with no factors is not enrolled", () => {
  assert.equal(deriveMfaState({ currentLevel: "aal1", nextLevel: "aal1", factors: [] }), "not_enrolled");
});
test("unverified (abandoned) enrollment still counts as not enrolled", () => {
  assert.equal(deriveMfaState({ currentLevel: "aal1", nextLevel: "aal1", factors: [{ id: "x", status: "unverified", factor_type: "totp" }] }), "not_enrolled");
  assert.deepEqual(staleUnverifiedFactorIds([{ id: "x", status: "unverified" }, { id: "y", status: "verified" }]), ["x"]);
});
test("enrolled user at AAL1 must be challenged; AAL2 is verified", () => {
  const factors = [{ id: "y", status: "verified", factor_type: "totp" }];
  assert.equal(deriveMfaState({ currentLevel: "aal1", nextLevel: "aal2", factors }), "challenge_required");
  assert.equal(deriveMfaState({ currentLevel: "aal2", nextLevel: "aal2", factors }), "verified");
  assert.equal(deriveMfaState(null), "loading");
});
test("sign-in routes to challenge only for AAL1 -> AAL2", () => {
  assert.equal(needsMfaChallenge({ currentLevel: "aal1", nextLevel: "aal2" }), true);
  assert.equal(needsMfaChallenge({ currentLevel: "aal1", nextLevel: "aal1" }), false);
  assert.equal(needsMfaChallenge({ currentLevel: "aal2", nextLevel: "aal2" }), false);
  assert.equal(needsMfaChallenge(null), false);
});
test("codes must be exactly 6 digits; next paths are same-origin only", () => {
  assert.equal(isValidTotpCode("123456"), true);
  for (const bad of ["12345", "1234567", "abcdef", "", null]) assert.equal(isValidTotpCode(bad), false);
  assert.equal(safeMfaNext("/analysis?q=1"), "/analysis?q=1");
  assert.equal(safeMfaNext("//evil.example"), "/morning-brief");
  assert.equal(safeMfaNext("https://evil.example"), "/morning-brief");
});
test("MFA UI never persists TOTP secrets or codes and keeps role checks separate", () => {
  const page = readFileSync("src/pages/AccountSecurity.tsx", "utf8");
  assert.equal(/localStorage|sessionStorage|\.from\(|\.insert\(|\.upsert\(/.test(page), false);
  assert.match(page, /mfa\.enroll\(/);
  assert.match(page, /mfa\.challengeAndVerify\(/);
  assert.equal(/admin|has_role|user_roles/i.test(page.replace(/administrator actions/g, "")), false);
  const auth = readFileSync("src/pages/Auth.tsx", "utf8");
  assert.match(auth, /needsMfaChallenge\(aal\)/);
  const app = readFileSync("src/App.tsx", "utf8");
  assert.match(app, /path="\/account\/security" element=\{<Protected><AccountSecurity/);
});
test("Ask panel shows a verify CTA for mfa_required instead of a generic error", () => {
  const panel = readFileSync("src/components/analysis/GovernedResearchPanel.tsx", "utf8");
  assert.match(panel, /response\.reason === "mfa_required"/);
  assert.match(panel, /\/account\/security\?next=/);
  assert.match(panel, /Verify two-step sign-in/);
});
