import { ProviderAdapter, NormalizedMetric, ProviderContext } from '../types';

/**
 * UN Comtrade API adapter
 * Bilateral trade flows, commodity trade data
 * Free tier available (rate-limited)
 */
export const comtradeAdapter: ProviderAdapter = {
  normalize(input: unknown, ctx: ProviderContext): NormalizedMetric[] {
    if (!input || typeof input !== 'object') return [];
    const metrics: NormalizedMetric[] = [];
    const data = input as Record<string, any>;

    // Comtrade returns { data: [...] } or { dataset: [...] }
    const records = data.data || data.dataset || [];
    if (!Array.isArray(records)) return [];

    for (const r of records) {
      const tradeValue = r.primaryValue ?? r.TradeValue ?? r.fobvalue;
      if (tradeValue === null || tradeValue === undefined) continue;

      const reporter = r.reporterISO || r.reporterCode || ctx.location.iso3;
      const partner = r.partnerISO || r.partnerCode || '';
      const flow = r.flowDesc || r.rgDesc || (r.flowCode === 'M' ? 'import' : 'export');
      const commodity = r.cmdDesc || r.cmdCode || 'total';
      const period = r.period?.toString() || r.yr?.toString() || '';

      metrics.push({
        domain: 'trade',
        metric: `trade_${flow.toLowerCase()}_${commodity.toLowerCase().replace(/[\s,]+/g, '_').slice(0, 50)}`,
        iso3: reporter,
        period,
        value: parseFloat(tradeValue),
        unit: 'USD',
        confidence: 0.9,
        source: 'un_comtrade',
        raw: {
          reporter, partner, flow, commodity, period,
          netWeight: r.netWgt ?? r.NetWeight,
          qty: r.qty,
        },
      });
    }

    return metrics;
  }
};
