export const OPPORTUNITY_PORTFOLIO_OPTIMIZER_VERSION = "aicis-opportunity-portfolio-v1";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const clamp = (value, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(value) || 0));
const lower = (value) => String(value ?? "").toLowerCase();

function profileFromPreferences(preferences = {}) {
  const raw = preferences?.alert_preferences?.opportunity_profile || preferences?.opportunity_profile || {};
  return {
    capital_available: finite(raw.capital_available) ? raw.capital_available : null,
    reserve_pct: finite(raw.reserve_pct) ? clamp(raw.reserve_pct, 0, 90) : 10,
    max_country_capital_pct: finite(raw.max_country_capital_pct) ? clamp(raw.max_country_capital_pct, 1, 100) : 60,
    max_sector_capital_pct: finite(raw.max_sector_capital_pct) ? clamp(raw.max_sector_capital_pct, 1, 100) : 60,
    max_positions: finite(raw.max_positions) ? Math.max(1, Math.floor(raw.max_positions)) : 8,
  };
}

function candidateUtility(candidate) {
  const expectedValue = candidate?.metrics?.expected_value;
  const capital = candidate?.capital_required;
  if (!finite(expectedValue) || !finite(capital) || capital <= 0) return null;
  if (expectedValue <= 0) return null;
  return {
    expected_value: expectedValue,
    capital,
    expected_value_per_capital: expectedValue / capital,
  };
}

function sameCurrency(candidates) {
  const currencies = [...new Set(candidates.map((item) => item.currency).filter(Boolean))];
  return currencies.length <= 1 ? (currencies[0] ?? null) : false;
}

function groupCapital(selected, key) {
  const totals = new Map();
  for (const item of selected) {
    const labels = Array.isArray(item[key]) && item[key].length ? item[key] : ["unclassified"];
    const share = item.capital_required / labels.length;
    for (const label of labels) {
      const normalized = lower(label);
      totals.set(normalized, (totals.get(normalized) || 0) + share);
    }
  }
  return totals;
}

function constraintsSatisfied(selected, deployableCapital, profile) {
  if (selected.length > profile.max_positions) return false;
  const total = selected.reduce((sum, item) => sum + item.capital_required, 0);
  if (total > deployableCapital + 1e-9) return false;

  const countryLimit = deployableCapital * (profile.max_country_capital_pct / 100);
  for (const value of groupCapital(selected, "countries").values()) {
    if (value > countryLimit + 1e-9) return false;
  }

  const sectorLimit = deployableCapital * (profile.max_sector_capital_pct / 100);
  for (const value of groupCapital(selected, "sectors").values()) {
    if (value > sectorLimit + 1e-9) return false;
  }

  return true;
}

function summarize(selected, capitalAvailable, deployableCapital, reserveCapital, currency, method, optimalityProven) {
  const capitalDeployed = selected.reduce((sum, item) => sum + item.capital_required, 0);
  const expectedValue = selected.reduce((sum, item) => sum + item.metrics.expected_value, 0);
  const baseProfit = selected.reduce((sum, item) => sum + item.metrics.base_profit, 0);
  const unusedDeployable = Math.max(0, deployableCapital - capitalDeployed);
  const totalCashRemaining = Math.max(0, capitalAvailable - capitalDeployed);

  return {
    optimizer_version: OPPORTUNITY_PORTFOLIO_OPTIMIZER_VERSION,
    optimization_method: method,
    optimality_proven: optimalityProven,
    currency,
    capital_available: round(capitalAvailable),
    reserve_capital: round(reserveCapital),
    deployable_capital: round(deployableCapital),
    capital_deployed: round(capitalDeployed),
    deployable_utilization_pct: deployableCapital > 0 ? round((capitalDeployed / deployableCapital) * 100, 2) : 0,
    unused_deployable_capital: round(unusedDeployable),
    total_cash_remaining: round(totalCashRemaining),
    expected_value: round(expectedValue),
    base_case_profit: round(baseProfit),
    selected_count: selected.length,
    selected: selected
      .slice()
      .sort((a, b) => b.metrics.expected_value - a.metrics.expected_value)
      .map((item) => ({
        candidate_id: item.candidate_id,
        title: item.title,
        score: item.score,
        capital_required: item.capital_required,
        currency: item.currency,
        expected_value: item.metrics.expected_value,
        base_profit: item.metrics.base_profit,
        expected_return_on_capital_pct: item.metrics.expected_return_on_capital_pct,
        countries: item.countries,
        sectors: item.sectors,
        execution_ready: item.execution_ready,
        human_approval_required: true,
      })),
    human_approval_required: true,
    external_execution_performed: false,
  };
}

function exactOptimize(candidates, deployableCapital, profile) {
  let best = [];
  let bestExpectedValue = 0;
  let bestCapital = 0;
  const n = candidates.length;

  function dfs(index, selected, totalCapital, totalExpectedValue) {
    if (selected.length > profile.max_positions || totalCapital > deployableCapital) return;
    if (index === n) {
      if (!constraintsSatisfied(selected, deployableCapital, profile)) return;
      if (
        totalExpectedValue > bestExpectedValue + 1e-9 ||
        (Math.abs(totalExpectedValue - bestExpectedValue) <= 1e-9 && totalCapital < bestCapital)
      ) {
        best = selected.slice();
        bestExpectedValue = totalExpectedValue;
        bestCapital = totalCapital;
      }
      return;
    }

    dfs(index + 1, selected, totalCapital, totalExpectedValue);

    const item = candidates[index];
    selected.push(item);
    dfs(
      index + 1,
      selected,
      totalCapital + item.capital_required,
      totalExpectedValue + item.metrics.expected_value,
    );
    selected.pop();
  }

  dfs(0, [], 0, 0);
  return best;
}

function greedyOptimize(candidates, deployableCapital, profile) {
  const sorted = candidates.slice().sort((a, b) => {
    const ua = candidateUtility(a);
    const ub = candidateUtility(b);
    const ra = ua ? ua.expected_value_per_capital : -Infinity;
    const rb = ub ? ub.expected_value_per_capital : -Infinity;
    if (rb !== ra) return rb - ra;
    return b.score - a.score;
  });

  const selected = [];
  for (const item of sorted) {
    const trial = [...selected, item];
    if (constraintsSatisfied(trial, deployableCapital, profile)) selected.push(item);
    if (selected.length >= profile.max_positions) break;
  }
  return selected;
}

export function optimizeOpportunityPortfolio(ranking = {}, preferences = {}) {
  const profile = profileFromPreferences(preferences);
  const capitalAvailable = profile.capital_available;

  if (!finite(capitalAvailable) || capitalAvailable <= 0) {
    return {
      optimizer_version: OPPORTUNITY_PORTFOLIO_OPTIMIZER_VERSION,
      allocation_available: false,
      reason: "capital_available_not_configured",
      selected: [],
      human_approval_required: true,
    };
  }

  const candidates = Array.isArray(ranking.ranked)
    ? ranking.ranked.filter((item) => item?.eligible !== false && candidateUtility(item))
    : [];

  const currency = sameCurrency(candidates);
  if (currency === false) {
    return {
      optimizer_version: OPPORTUNITY_PORTFOLIO_OPTIMIZER_VERSION,
      allocation_available: false,
      reason: "mixed_currency_portfolio_requires_verified_fx_layer",
      selected: [],
      human_approval_required: true,
    };
  }

  const reserveCapital = capitalAvailable * (profile.reserve_pct / 100);
  const deployableCapital = capitalAvailable - reserveCapital;
  const feasible = candidates.filter((item) => item.capital_required <= deployableCapital);

  if (!feasible.length) {
    return {
      ...summarize([], capitalAvailable, deployableCapital, reserveCapital, currency, "none", true),
      allocation_available: true,
      no_allocation_reason: "no_positive_expected_value_candidate_fits_capital_and_constraints",
    };
  }

  const EXACT_LIMIT = 18;
  const exact = feasible.length <= EXACT_LIMIT;
  const selected = exact
    ? exactOptimize(feasible, deployableCapital, profile)
    : greedyOptimize(feasible, deployableCapital, profile);

  return {
    ...summarize(
      selected,
      capitalAvailable,
      deployableCapital,
      reserveCapital,
      currency,
      exact ? "exact_subset_search" : "greedy_expected_value_per_capital",
      exact,
    ),
    allocation_available: true,
    no_allocation_reason: selected.length ? null : "no_candidate_combination_cleared_portfolio_constraints",
    constraints: {
      reserve_pct: profile.reserve_pct,
      max_country_capital_pct: profile.max_country_capital_pct,
      max_sector_capital_pct: profile.max_sector_capital_pct,
      max_positions: profile.max_positions,
    },
    optimization_scope_notice: "The allocation is optimized only across the ranked candidates supplied to this optimizer and does not prove a globally optimal portfolio.",
  };
}
