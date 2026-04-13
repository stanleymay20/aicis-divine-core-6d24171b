import { ProviderAdapter, NormalizedMetric, ProviderContext } from '../types';

/**
 * NOAA Climate Data Online (CDO) adapter
 * Historical weather, severe events, climate normals
 * Free with API token
 */
export const noaaAdapter: ProviderAdapter = {
  normalize(input: unknown, ctx: ProviderContext): NormalizedMetric[] {
    if (!input || typeof input !== 'object') return [];
    const metrics: NormalizedMetric[] = [];
    const data = input as Record<string, any>;

    // CDO API returns { results: [...] }
    const results = data.results || data.data || [];
    if (!Array.isArray(results)) return [];

    const unitMap: Record<string, string> = {
      TMAX: '°C', TMIN: '°C', TAVG: '°C', PRCP: 'mm',
      SNOW: 'mm', SNWD: 'mm', AWND: 'm/s', EVAP: 'mm',
    };

    const metricMap: Record<string, string> = {
      TMAX: 'temperature_max', TMIN: 'temperature_min', TAVG: 'temperature_avg',
      PRCP: 'precipitation', SNOW: 'snowfall', SNWD: 'snow_depth',
      AWND: 'wind_speed_avg', EVAP: 'evaporation',
    };

    for (const r of results) {
      const datatype = r.datatype || r.dataType || '';
      const value = r.value;
      if (value === null || value === undefined) continue;

      // NOAA stores temps in tenths of degrees C
      const adjustedValue = ['TMAX', 'TMIN', 'TAVG'].includes(datatype)
        ? value / 10
        : value;

      metrics.push({
        domain: 'climate',
        metric: metricMap[datatype] || datatype.toLowerCase(),
        iso3: ctx.location.iso3,
        period: r.date?.split('T')[0] || '',
        value: adjustedValue,
        unit: unitMap[datatype] || '',
        confidence: 0.92,
        source: 'noaa',
        raw: { datatype, station: r.station, date: r.date, value: r.value },
      });
    }

    return metrics;
  }
};
