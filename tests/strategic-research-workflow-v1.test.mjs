
import test from "node:test";
import assert from "node:assert/strict";
import {
  attachStrategicResearchWorkflows,
  researchWorkflowContextFromTransactionInput,
  resolveStrategicResearchWorkflow,
} from "../supabase/functions/_shared/strategic-research-workflow-v1.mjs";

function context() {
  return {
    product_name: "Cocoa beans",
    supplier_countries: ["Ghana"],
    buyer_countries: ["Germany"],
    origin_country: "Ghana",
    destination_country: "Germany",
    comparison_currency: "EUR",
  };
}

test("transaction input produces reusable workflow context", () => {
  const result = researchWorkflowContextFromTransactionInput({
    product: { id: "cocoa", name: "Cocoa beans" },
    comparison_currency: "eur",
    source_offers: [{ country: "Ghana" }, { country: "Ghana" }],
    sale_offers: [{ country: "Germany" }],
    routes: [{ origin_country: "Ghana", destination_country: "Germany" }],
  });

  assert.equal(result.product_name, "Cocoa beans");
  assert.deepEqual(result.supplier_countries, ["Ghana"]);
  assert.deepEqual(result.buyer_countries, ["Germany"]);
  assert.equal(result.origin_country, "Ghana");
  assert.equal(result.destination_country, "Germany");
  assert.equal(result.comparison_currency, "EUR");
});

test("supplier refresh routes to existing counterparty discovery with scoped context", () => {
  const workflow = resolveStrategicResearchWorkflow({
    kind: "refresh_supplier_quote",
    source_candidate_id: "candidate-1",
  }, context());

  assert.equal(workflow.status, "ready");
  assert.equal(workflow.kind, "counterparty_discovery");
  assert.equal(workflow.payload.role, "supplier");
  assert.deepEqual(workflow.payload.countries, ["Ghana"]);
  assert.equal(workflow.execution_boundary, "discovery_candidates_only");
});

test("buyer refresh routes to buyer discovery", () => {
  const workflow = resolveStrategicResearchWorkflow({ kind: "refresh_buyer_quote" }, context());
  assert.equal(workflow.status, "ready");
  assert.equal(workflow.payload.role, "buyer");
  assert.deepEqual(workflow.payload.countries, ["Germany"]);
});

test("route refresh requires origin and destination and routes to logistics discovery", () => {
  const workflow = resolveStrategicResearchWorkflow({ kind: "refresh_route_quote" }, context());
  assert.equal(workflow.status, "ready");
  assert.equal(workflow.payload.role, "logistics");
  assert.equal(workflow.payload.origin_country, "Ghana");
  assert.equal(workflow.payload.destination_country, "Germany");
});

test("missing discovery context fails closed instead of inventing it", () => {
  const workflow = resolveStrategicResearchWorkflow(
    { kind: "refresh_supplier_quote" },
    { product_name: "Cocoa beans", supplier_countries: [] },
  );
  assert.equal(workflow.status, "requires_context");
  assert.deepEqual(workflow.missing_context, ["supplier_countries"]);
});

test("official reference FX can start research but remains non-executable", () => {
  const workflow = resolveStrategicResearchWorkflow({ kind: "verified_fx_normalization" }, context());
  assert.equal(workflow.status, "ready");
  assert.equal(workflow.kind, "reference_fx");
  assert.equal(workflow.execution_boundary, "reference_only_not_execution_quote");
});

test("executable FX explicitly requires a provider adapter", () => {
  const workflow = resolveStrategicResearchWorkflow({ kind: "obtain_executable_fx_quote" }, context());
  assert.equal(workflow.status, "provider_required");
  assert.equal(workflow.kind, "executable_fx_provider");
  assert.equal(workflow.execution_boundary, "no_order_or_money_movement");
});

test("compliance review requires counterparty identity context", () => {
  const workflow = resolveStrategicResearchWorkflow({ kind: "complete_compliance_review" }, context());
  assert.equal(workflow.status, "requires_context");
  assert.ok(workflow.missing_context.includes("legal_name"));
  assert.ok(workflow.missing_context.includes("role"));
});

test("capability gap routes to Know Yourself profile instead of auto-claiming capability", () => {
  const workflow = resolveStrategicResearchWorkflow({ kind: "resolve_capability_gap" }, context());
  assert.equal(workflow.status, "ready");
  assert.equal(workflow.kind, "actor_profile");
  assert.equal(workflow.execution_boundary, "profile_update_only_after_capability_is_real");
});

test("strategy evidence tasks route to the transaction input editor", () => {
  for (const kind of [
    "validate_scenario",
    "evidence_information_value",
    "evidence_position_value",
    "investigate_indirect_structure",
  ]) {
    const workflow = resolveStrategicResearchWorkflow({ kind }, context());
    assert.equal(workflow.status, "ready");
    assert.equal(workflow.kind, "transaction_input_editor");
  }
});

test("sensitive assumption remains manual research until a source adapter exists", () => {
  const workflow = resolveStrategicResearchWorkflow({ kind: "validate_sensitive_assumption" }, context());
  assert.equal(workflow.status, "manual_research");
  assert.equal(workflow.kind, "assumption_research");
  assert.equal(workflow.execution_boundary, "evidence_collection_only");
});

test("plan attachment preserves planner fields and adds workflow status counts", () => {
  const plan = {
    planner_version: "planner-v1",
    action_count: 3,
    actions: [
      { id: "a", kind: "refresh_supplier_quote" },
      { id: "b", kind: "obtain_executable_fx_quote" },
      { id: "c", kind: "complete_compliance_review" },
    ],
  };

  const result = attachStrategicResearchWorkflows(plan, context());
  assert.equal(result.planner_version, "planner-v1");
  assert.equal(result.workflow_status_counts.ready, 1);
  assert.equal(result.workflow_status_counts.provider_required, 1);
  assert.equal(result.workflow_status_counts.requires_context, 1);
  assert.equal(result.actions.length, 3);
});

test("ready workflows never claim external execution", () => {
  const result = attachStrategicResearchWorkflows({
    actions: [
      { id: "a", kind: "refresh_supplier_quote" },
      { id: "b", kind: "verified_fx_normalization" },
      { id: "c", kind: "resolve_capability_gap" },
    ],
  }, context());

  assert.ok(result.actions.every((item) => item.workflow.external_execution_performed === false));
  assert.ok(result.actions.every((item) => item.workflow.read_only_or_research_only === true));
});
