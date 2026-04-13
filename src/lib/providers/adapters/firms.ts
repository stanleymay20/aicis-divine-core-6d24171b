import { ProviderAdapter, NormalizedMetric, ProviderContext } from '../types';

/**
 * NASA FIRMS (Fire Information for Resource Management System) adapter
 * Active fire/hotspot detection from MODIS and VIIRS satellites
 * Free, no auth required for CSV/JSON endpoints
 */
export const firmsAdapter: ProviderAdapter = {
  normalize(input: unknown, ctx: ProviderContext): NormalizedMetric[] {
    if (!input) return [];
    const metrics: NormalizedMetric[] = [];

    // FIRMS returns array of fire detections
    const records = Array.isArray(input) ? input : (input as any).data || [];
    if (!Array.isArray(records)) return [];

    for (const r of records) {
      const lat = parseFloat(r.latitude);
      const lon = parseFloat(r.longitude);
      const brightness = parseFloat(r.bright_ti4 || r.brightness);
      const frp = parseFloat(r.frp); // Fire Radiative Power
      const confidence = r.confidence;

      if (isNaN(lat) || isNaN(lon)) continue;

      // Brightness metric
      if (!isNaN(brightness)) {
        metrics.push({
          domain: 'climate',
          metric: 'fire_brightness',
          iso3: ctx.location.iso3,
          period: r.acq_date || '',
          value: brightness,
          unit: 'K',
          confidence: parseConfidence(confidence),
          source: 'nasa_firms',
          raw: { lat, lon, satellite: r.satellite, instrument: r.instrument, acq_time: r.acq_time },
        });
      }

      // Fire Radiative Power
      if (!isNaN(frp)) {
        metrics.push({
          domain: 'climate',
          metric: 'fire_radiative_power',
          iso3: ctx.location.iso3,
          period: r.acq_date || '',
          value: frp,
          unit: 'MW',
          confidence: parseConfidence(confidence),
          source: 'nasa_firms',
          raw: { lat, lon, satellite: r.satellite, daynight: r.daynight },
        });
      }
    }

    return metrics;
  }
};

function parseConfidence(c: any): number {
  if (typeof c === 'number') return c / 100;
  if (c === 'high' || c === 'h') return 0.9;
  if (c === 'nominal' || c === 'n') return 0.7;
  if (c === 'low' || c === 'l') return 0.4;
  return 0.5;
}
