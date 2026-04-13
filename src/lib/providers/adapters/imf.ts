import { ProviderAdapter, NormalizedMetric, ProviderContext } from '../types';

/**
 * IMF Data API adapter
 * Endpoints: World Economic Outlook, IFS (International Financial Statistics)
 * Free, no auth required
 */
export const imfAdapter: ProviderAdapter = {
  normalize(input: unknown, ctx: ProviderContext): NormalizedMetric[] {
    if (!input || typeof input !== 'object') return [];
    const metrics: NormalizedMetric[] = [];
    const data = input as Record<string, any>;

    // IMF CompactData format: structure.observations
    if (data.CompactData?.DataSet?.Series) {
      const series = Array.isArray(data.CompactData.DataSet.Series)
        ? data.CompactData.DataSet.Series
        : [data.CompactData.DataSet.Series];

      for (const s of series) {
        const indicator = s['@INDICATOR'] || s['@SUBJECT'] || ctx.endpoint;
        const country = s['@REF_AREA'] || ctx.location.iso3;
        const unit = s['@UNIT_MULT'] ? `10^${s['@UNIT_MULT']}` : '';
        const obs = Array.isArray(s.Obs) ? s.Obs : s.Obs ? [s.Obs] : [];

        for (const o of obs) {
          const value = parseFloat(o['@OBS_VALUE']);
          if (isNaN(value)) continue;
          metrics.push({
            domain: 'finance',
            metric: indicator.toLowerCase().replace(/\s+/g, '_'),
            iso3: country,
            period: o['@TIME_PERIOD'] || '',
            value,
            unit,
            confidence: 0.95,
            source: 'imf',
            raw: { indicator, country, period: o['@TIME_PERIOD'], value },
          });
        }
      }
    }

    // IMF JSON REST format (v2): values array
    if (data.values) {
      const vals = Array.isArray(data.values) ? data.values : [];
      for (const v of vals) {
        if (v.value === null || v.value === undefined) continue;
        metrics.push({
          domain: 'finance',
          metric: ctx.endpoint,
          iso3: v['@GEO_PRIM'] || ctx.location.iso3,
          period: v['@TIME_PERIOD'] || '',
          value: parseFloat(v.value),
          confidence: 0.95,
          source: 'imf',
          raw: v,
        });
      }
    }

    return metrics;
  }
};
