import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCounterpartyQueries,
  normalizeDiscoveryHits,
  extractGenericBusinessEmails,
  attachPublicBusinessContacts,
} from "../supabase/functions/_shared/counterparty-discovery-v1.mjs";

test("builds deterministic supplier discovery queries from product and country", () => {
  const queries = buildCounterpartyQueries({
    product_name: "cocoa beans",
    role: "supplier",
    countries: ["Ghana"],
  });
  assert.ok(queries.length >= 2);
  assert.ok(queries.every((query) => query.includes("cocoa beans")));
  assert.ok(queries.some((query) => query.includes("Ghana")));
});

test("normalizes open-web hits as discovery-only and never transaction eligible", () => {
  const hits = [
    { url: "https://example.com/cocoa", title: "Cocoa exporter in Ghana", description: "Supplier and exporter of cocoa beans in Ghana." },
  ];
  const result = normalizeDiscoveryHits(hits, {
    product_name: "cocoa beans",
    role: "supplier",
    countries: ["Ghana"],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].verification_status, "discovery_only_unverified");
  assert.equal(result[0].transaction_eligible, false);
  assert.equal(result[0].compliance_status, "unknown");
  assert.equal(result[0].official_site_status, "not_verified");
});

test("deduplicates discovery results by domain", () => {
  const hits = [
    { url: "https://example.com/a", title: "Cocoa supplier", description: "Ghana exporter" },
    { url: "https://www.example.com/b", title: "Cocoa beans exporter Ghana", description: "Supplier producer exporter" },
  ];
  const result = normalizeDiscoveryHits(hits, {
    product_name: "cocoa",
    role: "supplier",
    countries: ["Ghana"],
  });
  assert.equal(result.length, 1);
});

test("excludes social-network results from company discovery", () => {
  const hits = [
    { url: "https://linkedin.com/company/example", title: "Example", description: "Cocoa supplier" },
    { url: "https://example.com", title: "Example cocoa supplier", description: "Ghana" },
  ];
  const result = normalizeDiscoveryHits(hits, {
    product_name: "cocoa",
    role: "supplier",
    countries: ["Ghana"],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].domain, "example.com");
});

test("extracts only generic public business mailboxes and excludes personal-looking emails", () => {
  const text = "Contact sales@example.com, procurement@example.com, jane.doe@example.com or ceo@example.com.";
  const emails = extractGenericBusinessEmails(text, "example.com");
  assert.deepEqual(emails, ["procurement@example.com", "sales@example.com"]);
});

test("generic business emails must match the discovered company domain", () => {
  const text = "sales@example.com sales@other.com info@sub.example.com";
  const emails = extractGenericBusinessEmails(text, "example.com");
  assert.deepEqual(emails, ["info@sub.example.com", "sales@example.com"]);
});

test("attaching public contact channels does not alter unverified execution status", () => {
  const candidate = normalizeDiscoveryHits([
    { url: "https://example.com", title: "Cocoa supplier Ghana", description: "Exporter" },
  ], { product_name: "cocoa", role: "supplier", countries: ["Ghana"] })[0];
  const enriched = attachPublicBusinessContacts(candidate, "Email sales@example.com for export enquiries.");
  assert.equal(enriched.contact_channels.length, 1);
  assert.equal(enriched.transaction_eligible, false);
  assert.equal(enriched.verification_status, "discovery_only_unverified");
});
