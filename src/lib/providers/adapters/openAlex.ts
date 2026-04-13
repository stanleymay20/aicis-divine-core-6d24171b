import { ProviderAdapter, NormalizedMetric, ProviderContext } from '../types';

/**
 * OpenAlex API adapter
 * Academic research, institutions, topics, citation data
 * Free, no auth required
 */
export const openAlexAdapter: ProviderAdapter = {
  normalize(input: unknown, ctx: ProviderContext): NormalizedMetric[] {
    if (!input || typeof input !== 'object') return [];
    const metrics: NormalizedMetric[] = [];
    const data = input as Record<string, any>;

    // OpenAlex returns { results: [...] } for works/institutions/topics
    const results = data.results || [];
    if (!Array.isArray(results)) return [];

    for (const r of results) {
      // Works endpoint
      if (r.cited_by_count !== undefined) {
        const year = r.publication_year?.toString() || '';
        const title = r.display_name || r.title || '';

        metrics.push({
          domain: 'research',
          metric: 'citation_count',
          iso3: extractCountryFromInstitutions(r.authorships),
          period: year,
          value: r.cited_by_count || 0,
          unit: 'citations',
          confidence: 0.95,
          source: 'openalex',
          raw: {
            id: r.id, title: title.slice(0, 200),
            type: r.type, doi: r.doi,
            concepts: r.concepts?.slice(0, 5)?.map((c: any) => c.display_name),
          },
        });
      }

      // Institutions endpoint
      if (r.works_count !== undefined && r.type === undefined) {
        metrics.push({
          domain: 'research',
          metric: 'institution_output',
          iso3: r.geo?.country_code || ctx.location.iso3,
          period: new Date().getFullYear().toString(),
          value: r.works_count,
          unit: 'publications',
          confidence: 0.9,
          source: 'openalex',
          raw: {
            id: r.id, name: r.display_name,
            h_index: r.summary_stats?.h_index,
            i10_index: r.summary_stats?.i10_index,
          },
        });
      }

      // Topics/concepts with counts_by_year
      if (r.counts_by_year && Array.isArray(r.counts_by_year)) {
        for (const y of r.counts_by_year) {
          metrics.push({
            domain: 'research',
            metric: `topic_${(r.display_name || 'unknown').toLowerCase().replace(/\s+/g, '_').slice(0, 40)}`,
            iso3: ctx.location.iso3,
            period: y.year?.toString() || '',
            value: y.works_count || 0,
            unit: 'publications',
            confidence: 0.9,
            source: 'openalex',
            raw: { topic_id: r.id, cited: y.cited_by_count },
          });
        }
      }
    }

    return metrics;
  }
};

function extractCountryFromInstitutions(authorships: any[]): string | undefined {
  if (!Array.isArray(authorships)) return undefined;
  for (const a of authorships) {
    const inst = a.institutions?.[0];
    if (inst?.country_code) return inst.country_code;
  }
  return undefined;
}
