/**
 * AICIS Impact Model — Normalized Severity Band Mapping
 * Maps (impact_score, confidence, domain, geography) → structured severity assessment.
 * No hardcoded presentation text. Purely computational.
 */

import { type IntelligenceDomain, type SeverityBand, classifySeverity } from './event-types';

// ── Domain sensitivity weights (how amplifying is stress in this domain?) ──
const DOMAIN_SENSITIVITY: Record<IntelligenceDomain, number> = {
  governance: 1.3,
  health: 1.2,
  energy: 1.15,
  finance: 1.25,
  food: 1.1,
  security: 1.35,
  education: 0.8,
  climate: 0.9,
  population: 0.75,
};

// ── Geographic vulnerability tiers ──────────────────────────────────
export type GeoVulnerabilityTier = 'fragile' | 'developing' | 'stable' | 'resilient';

const GEO_AMPLIFIERS: Record<GeoVulnerabilityTier, number> = {
  fragile: 1.4,
  developing: 1.15,
  stable: 1.0,
  resilient: 0.85,
};

// ── Impact Assessment Output ────────────────────────────────────────
export interface ImpactAssessment {
  rawScore: number;            // 0–100, input
  adjustedScore: number;       // 0–100, after domain/geo amplification
  confidence: number;          // 0–1
  severityBand: SeverityBand;
  domain: IntelligenceDomain;
  geoTier: GeoVulnerabilityTier;
  domainAmplifier: number;
  geoAmplifier: number;
  isActionable: boolean;       // adjusted ≥ 40 AND confidence ≥ 0.4
  isUrgent: boolean;           // adjusted ≥ 70 AND confidence ≥ 0.5
}

export interface ImpactModelConfig {
  actionableThreshold: number;     // default 40
  urgentThreshold: number;         // default 70
  minConfidenceActionable: number; // default 0.4
  minConfidenceUrgent: number;     // default 0.5
}

const DEFAULT_CONFIG: ImpactModelConfig = {
  actionableThreshold: 40,
  urgentThreshold: 70,
  minConfidenceActionable: 0.4,
  minConfidenceUrgent: 0.5,
};

/**
 * Compute a normalized impact assessment.
 */
export function assessImpact(
  rawScore: number,
  confidence: number,
  domain: IntelligenceDomain,
  geoTier: GeoVulnerabilityTier = 'stable',
  config: Partial<ImpactModelConfig> = {},
): ImpactAssessment {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const domainAmp = DOMAIN_SENSITIVITY[domain] ?? 1.0;
  const geoAmp = GEO_AMPLIFIERS[geoTier];

  const adjusted = Math.min(100, Math.max(0, rawScore * domainAmp * geoAmp));
  const band = classifySeverity(adjusted);

  return {
    rawScore,
    adjustedScore: Math.round(adjusted * 10) / 10,
    confidence: Math.min(1, Math.max(0, confidence)),
    severityBand: band,
    domain,
    geoTier,
    domainAmplifier: domainAmp,
    geoAmplifier: geoAmp,
    isActionable: adjusted >= cfg.actionableThreshold && confidence >= cfg.minConfidenceActionable,
    isUrgent: adjusted >= cfg.urgentThreshold && confidence >= cfg.minConfidenceUrgent,
  };
}

/**
 * Batch-assess an array of raw impact inputs.
 */
export function batchAssessImpact(
  items: Array<{
    rawScore: number;
    confidence: number;
    domain: IntelligenceDomain;
    geoTier?: GeoVulnerabilityTier;
  }>,
  config?: Partial<ImpactModelConfig>,
): ImpactAssessment[] {
  return items.map(i => assessImpact(i.rawScore, i.confidence, i.domain, i.geoTier, config));
}
