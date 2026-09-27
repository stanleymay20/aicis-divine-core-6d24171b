
import test from "node:test";
import assert from "node:assert/strict";
import { planStrategicResearch } from "../supabase/functions/_shared/strategic-research-planner-v1.mjs";

test("expired supplier buyer and route evidence become blocking refresh tasks", () => {
  const result = planStrategicResearch({
    build: {
      rejected_paths: [{
        reasons: [
          "source_offer_not_verified_or_expired",
          "sale_offer_not_verified_or_expired",
          "route_not_verified_or_expired",
        ],
      }],
    },
  });

  assert.equal(result.blocking_count, 3);
  assert.ok(result.actions.some((item) => item.kind === "refresh_supplier_quote"));
  assert.ok(result.actions.some((item) => item.kind === "refresh_buyer_quote"));
  assert.ok(result.actions.some((item) => item.kind === "refresh_route_quote"));
  assert.ok(result.actions.every((item) => item.research_only === true));
  assert.ok(result.actions.every((item) => item.expected_value === null));
});

test("capital infeasibility generates a lower-capital research task only when no evidenced indirect option exists", () => {
  const strategic = {
    options: [{
      id: "direct",
      source_candidate_id: "c1",
      directness: "direct",
      feasibility_reasons: ["capital_required_exceeds_deployable_after_reserve"],
      missing_capabilities: [],
      research_only: false,
      strategy_type: "direct_transaction",
    }],
  };

  const result = planStrategicResearch({ strategic });
  const action = result.actions.find((item) => item.kind === "investigate_indirect_structure");
  assert.ok(action);
  assert.equal(action.source_candidate_id, "c1");

  const withIndirect = planStrategicResearch({
    strategic: {
      options: [
        ...strategic.options,
        {
          id: "broker",
          source_candidate_id: "c1",
          directness: "indirect",
          feasibility_reasons: [],
          research_only: false,
          strategy_type: "indirect",
        },
      ],
    },
  });
  assert.equal(withIndirect.actions.some((item) => item.kind === "investigate_indirect_structure"), false);
});

test("missing capabilities produce explicit capability-resolution tasks without inventing acquisition path", () => {
  const result = planStrategicResearch({
    strategic: {
      options: [{
        id: "broker",
        source_candidate_id: "c1",
        directness: "indirect",
        feasibility_reasons: ["missing_required_capabilities"],
        missing_capabilities: ["import licence", "warehouse access"],
        research_only: false,
        strategy_type: "indirect",
      }],
    },
  });

  const gaps = result.actions.filter((item) => item.kind === "resolve_capability_gap");
  assert.equal(gaps.length, 2);
  assert.ok(gaps.every((item) => item.priority === "blocking"));
  assert.ok(gaps.some((item) => /import licence/i.test(item.title)));
  assert.ok(gaps.some((item) => /warehouse access/i.test(item.title)));
});

test("mixed-currency strategy comparison generates verified-FX normalization research", () => {
  const result = planStrategicResearch({
    strategic: {
      comparison_blocked_reason: "mixed_currency_strategy_options_require_verified_fx_normalization",
      options: [],
    },
  });

  assert.equal(result.actions[0].kind, "verified_fx_normalization");
  assert.equal(result.actions[0].priority, "blocking");
  assert.match(result.actions[0].completion_criteria[0], /normalized comparison currency/i);
});

test("reference FX execution gap generates executable-quote task", () => {
  const result = planStrategicResearch({
    ranking: {
      ranked: [{
        candidate_id: "c1",
        execution_ready: false,
        execution_dossier: {
          missing_execution_fields: ["executable_fx_quote"],
          who: { contacts: [{ company: "Buyer", channel: "sales" }] },
        },
      }],
    },
  });

  const action = result.actions.find((item) => item.kind === "obtain_executable_fx_quote");
  assert.ok(action);
  assert.equal(action.source_candidate_id, "c1");
  assert.match(action.required_evidence.join(" "), /executable FX quote/i);
});

test("research-only information and position options get evidence tasks rather than economic recommendations", () => {
  const result = planStrategicResearch({
    strategic: {
      options: [
        {
          id: "inspect",
          source_candidate_id: "c1",
          strategy_type: "information_gathering",
          research_only: true,
          feasibility_reasons: ["expected_value_unknown", "research_only"],
          missing_capabilities: [],
        },
        {
          id: "exclusive",
          source_candidate_id: "c1",
          strategy_type: "position_building",
          research_only: true,
          feasibility_reasons: ["expected_value_unknown", "research_only"],
          missing_capabilities: [],
        },
      ],
    },
  });

  assert.ok(result.actions.some((item) => item.kind === "evidence_information_value"));
  assert.ok(result.actions.some((item) => item.kind === "evidence_position_value"));
  assert.ok(result.actions.every((item) => item.transaction_eligible === false));
});

test("most damaging user-defined sensitivity case becomes a high-priority evidence task", () => {
  const result = planStrategicResearch({
    strategic: {
      primary_strategy: {
        id: "broker",
        source_candidate_id: "c1",
        sensitivity: {
          cases: [{
            id: "buyer-down",
            assumption: "buyer price",
            delta_expected_value: -1600,
            evidence_status: "user_defined_scenario",
          }],
        },
      },
      options: [],
    },
  });

  const action = result.actions.find((item) => item.kind === "validate_sensitive_assumption");
  assert.ok(action);
  assert.equal(action.priority, "high");
  assert.match(action.title, /buyer price/i);
});

test("planner deduplicates shared blockers and sorts blocking tasks first", () => {
  const result = planStrategicResearch({
    build: {
      rejected_paths: [
        { reasons: ["source_offer_not_verified_or_expired"] },
        { reasons: ["source_offer_not_verified_or_expired"] },
      ],
    },
    strategic: {
      primary_strategy: {
        id: "x",
        sensitivity: {
          cases: [{
            id: "stress",
            assumption: "demand",
            delta_expected_value: -10,
            evidence_status: "attributable",
          }],
        },
      },
      options: [],
    },
  });

  assert.equal(result.actions.filter((item) => item.kind === "refresh_supplier_quote").length, 1);
  assert.equal(result.actions[0].priority, "blocking");
});

test("empty evidence stack produces no invented research tasks", () => {
  const result = planStrategicResearch({});
  assert.equal(result.action_count, 0);
  assert.deepEqual(result.actions, []);
  assert.match(result.scope_notice, /observed blockers/i);
});
