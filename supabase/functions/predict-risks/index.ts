import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_DIVISIONS = [
  "finance",
  "energy",
  "health",
  "food",
  "governance",
  "defense",
  "diplomacy",
  "crisis",
] as const;

const ALLOWED_DIVISIONS = new Set<string>(DEFAULT_DIVISIONS);
const DAY_MS = 86_400_000;

type UnknownRecord = Record<string, unknown>;

interface CalibrationRow {
  domain: string;
  observedCount: number;
  observedPositiveRate: number | null;
  trustScore: number | null;
  calibrationSampleSize: number;
  lastRealizedAt: string | null;
}

interface GraphEdge {
  relationshipKey: string;
  relationType: string;
  direction: string;
  subjectKey: string;
  objectKey: string;
  method: string;
  decayedWeight: number | null;
  confidence: number | null;
  sampleSize: number | null;
}

interface EvidenceCounts {
  recent_events: number;
  normalized_events: number;
  active_anomalies: number;
  active_crises: number;
  active_threats: number;
  defense_posture_rows: number;
  measured_graph_edges: number;
}

interface EvidenceDiagnostics {
  score: number;
  method: string;
  channel_count: number;
  distinct_provider_labels: number;
  measured_graph_edges: number;
  calibrated_domains: number;
  target_domains: number;
  components: {
    channel_coverage: number;
    provider_diversity: number;
    measured_graph_support: number;
    calibration_coverage: number;
  };
}

interface AggregatedCalibration {
  baseRateProbability: number | null;
  calibrationTrust: number | null;
  sampleSize: number;
  domains: string[];
}

interface NormalizedPathway {
  relationship_keys: string[];
  interpretation: "structural_dependency" | "association" | "relationship_path";
  rationale: string;
}

interface NormalizedCounterfactual {
  intervention: string;
  direction: "increase" | "decrease" | "uncertain";
  rationale: string;
  evidence_refs: string[];
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRows(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asText(value: unknown, maxLength = 2_000): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function asTextArray(value: unknown, maxItems = 20, maxLength = 500): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function asNumberInRange(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function asIntegerInRange(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sanitizeDivisions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => ALLOWED_DIVISIONS.has(item)),
    ),
  ].slice(0, DEFAULT_DIVISIONS.length);
}

function parseCalibrationRows(value: unknown): CalibrationRow[] {
  const rows: CalibrationRow[] = [];
  for (const row of asRows(value)) {
    const domain = asText(row.domain, 64);
    if (!domain) continue;
    rows.push({
      domain: domain.toLowerCase(),
      observedCount: Math.max(0, Number(row.observed_count) || 0),
      observedPositiveRate: asNumberInRange(row.observed_positive_rate, 0, 1),
      trustScore: asNumberInRange(row.trust_score, 0, 1),
      calibrationSampleSize: Math.max(0, Number(row.calibration_sample_size) || 0),
      lastRealizedAt: asText(row.last_realized_at, 64),
    });
  }
  return rows;
}

function parseGraphEdges(value: unknown, divisions: string[]): GraphEdge[] {
  const rows: GraphEdge[] = [];
  for (const row of asRows(value)) {
    const relationshipKey = asText(row.relationship_key, 300);
    const relationType = asText(row.relation_type, 120);
    const subjectKey = asText(row.subject_key, 300);
    const objectKey = asText(row.object_key, 300);
    if (!relationshipKey || !relationType || !subjectKey || !objectKey) continue;

    const searchable = `${subjectKey} ${objectKey}`.toLowerCase();
    if (!divisions.some((division) => searchable.includes(division))) continue;

    rows.push({
      relationshipKey,
      relationType,
      direction: asText(row.direction, 32) ?? "unknown",
      subjectKey,
      objectKey,
      method: asText(row.method, 160) ?? "unspecified",
      decayedWeight: asNumberInRange(row.decayed_weight, 0, 1),
      confidence: asNumberInRange(row.confidence, 0, 1),
      sampleSize: asNumberInRange(row.sample_size, 0, Number.MAX_SAFE_INTEGER),
    });
  }
  return rows.slice(0, 30);
}

function providerLabelsFromRows(normalizedRows: UnknownRecord[], intelRows: UnknownRecord[]): string[] {
  const labels = new Set<string>();
  for (const row of normalizedRows) {
    const label =
      asText(row.provider_name, 160) ??
      asText(row.provenance_source, 160) ??
      asText(row.source_name, 160);
    if (label) labels.add(label.toLowerCase());
  }
  for (const row of intelRows) {
    const label = asText(row.source_system, 160);
    if (label) labels.add(label.toLowerCase());
  }
  return [...labels].sort();
}

function computeEvidenceDiagnostics(
  counts: EvidenceCounts,
  providerLabelCount: number,
  calibrationRows: CalibrationRow[],
  targetDomainCount: number,
): EvidenceDiagnostics {
  const channelCount = [
    counts.recent_events,
    counts.normalized_events,
    counts.active_anomalies,
    counts.active_crises,
    counts.active_threats,
    counts.defense_posture_rows,
  ].filter((count) => count > 0).length;

  const calibratedDomains = calibrationRows.filter(
    (row) => row.observedCount >= 5 || row.calibrationSampleSize >= 5,
  ).length;

  const channelCoverage = Math.min(1, channelCount / 4);
  const providerDiversity = Math.min(1, providerLabelCount / 4);
  const measuredGraphSupport = Math.min(1, counts.measured_graph_edges / 6);
  const calibrationCoverage = Math.min(
    1,
    calibratedDomains / Math.max(1, targetDomainCount),
  );

  const score = round(
    100 *
      (
        0.4 * channelCoverage +
        0.25 * providerDiversity +
        0.2 * measuredGraphSupport +
        0.15 * calibrationCoverage
      ),
  );

  return {
    score,
    method: "evidence_sufficiency_diagnostic_v1_not_probability",
    channel_count: channelCount,
    distinct_provider_labels: providerLabelCount,
    measured_graph_edges: counts.measured_graph_edges,
    calibrated_domains: calibratedDomains,
    target_domains: targetDomainCount,
    components: {
      channel_coverage: round(channelCoverage),
      provider_diversity: round(providerDiversity),
      measured_graph_support: round(measuredGraphSupport),
      calibration_coverage: round(calibrationCoverage),
    },
  };
}

function aggregateCalibration(
  rows: CalibrationRow[],
  divisions: string[],
): AggregatedCalibration {
  const relevant = rows.filter(
    (row) =>
      divisions.includes(row.domain) &&
      row.observedCount >= 5 &&
      row.observedPositiveRate !== null,
  );

  const observedWeight = relevant.reduce((sum, row) => sum + row.observedCount, 0);
  const baseRateProbability =
    observedWeight > 0
      ? round(
          100 *
            relevant.reduce(
              (sum, row) =>
                sum + (row.observedPositiveRate ?? 0) * row.observedCount,
              0,
            ) /
            observedWeight,
        )
      : null;

  const trustRows = rows.filter(
    (row) =>
      divisions.includes(row.domain) &&
      row.calibrationSampleSize >= 5 &&
      row.trustScore !== null,
  );
  const trustWeight = trustRows.reduce(
    (sum, row) => sum + row.calibrationSampleSize,
    0,
  );
  const calibrationTrust =
    trustWeight > 0
      ? round(
          100 *
            trustRows.reduce(
              (sum, row) =>
                sum + (row.trustScore ?? 0) * row.calibrationSampleSize,
              0,
            ) /
            trustWeight,
        )
      : null;

  return {
    baseRateProbability,
    calibrationTrust,
    sampleSize: Math.max(observedWeight, trustWeight),
    domains: [...new Set([...relevant, ...trustRows].map((row) => row.domain))],
  };
}

function normalizePathways(
  value: unknown,
  graphMap: Map<string, GraphEdge>,
): NormalizedPathway[] {
  if (!Array.isArray(value)) return [];
  const pathways: NormalizedPathway[] = [];

  for (const item of value.slice(0, 8)) {
    if (!isRecord(item)) continue;
    const relationshipKeys = asTextArray(item.relationship_keys, 8, 300).filter(
      (key) => graphMap.has(key),
    );
    const rationale = asText(item.rationale, 1_000);
    if (relationshipKeys.length === 0 || !rationale) continue;

    const edges = relationshipKeys
      .map((key) => graphMap.get(key))
      .filter((edge): edge is GraphEdge => Boolean(edge));
    const hasCorrelation = edges.some((edge) =>
      edge.relationType.toLowerCase().includes("correlat"),
    );
    const isStructural = edges.every((edge) =>
      /(depend|suppl|member|parent|operat|trade)/i.test(edge.relationType),
    );

    pathways.push({
      relationship_keys: relationshipKeys,
      interpretation: hasCorrelation
        ? "association"
        : isStructural
          ? "structural_dependency"
          : "relationship_path",
      rationale,
    });
  }

  return pathways;
}

function normalizeCounterfactuals(value: unknown): NormalizedCounterfactual[] {
  if (!Array.isArray(value)) return [];
  const items: NormalizedCounterfactual[] = [];

  for (const item of value.slice(0, 8)) {
    if (!isRecord(item)) continue;
    const intervention = asText(item.intervention, 500);
    const rationale = asText(item.rationale, 1_000);
    const rawDirection = asText(item.direction, 32);
    const direction =
      rawDirection === "increase" ||
      rawDirection === "decrease" ||
      rawDirection === "uncertain"
        ? rawDirection
        : null;

    if (!intervention || !rationale || !direction) continue;
    items.push({
      intervention,
      direction,
      rationale,
      evidence_refs: asTextArray(item.evidence_refs, 12, 300),
    });
  }

  return items;
}

function deriveRiskLevel(probability: number, impact: number): string {
  const score = 0.5 * probability + 0.5 * impact;
  if (score >= 80) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}

async function recordAbstention(options: {
  adminClient: ReturnType<typeof createClient>;
  userId: string;
  divisions: string[];
  reason: string;
  evidenceCounts: EvidenceCounts;
  diagnostics: EvidenceDiagnostics;
  sourceIndependence: UnknownRecord;
  calibrationRows: CalibrationRow[];
  modelProvider?: string;
  modelName?: string;
  metadata?: UnknownRecord;
}) {
  const {
    adminClient,
    userId,
    divisions,
    reason,
    evidenceCounts,
    diagnostics,
    sourceIndependence,
    calibrationRows,
    modelProvider,
    modelName,
    metadata = {},
  } = options;

  await adminClient.from("forecast_abstentions").insert({
    requested_by: userId,
    affected_divisions: divisions,
    reason: reason.slice(0, 2_000),
    evidence_counts: evidenceCounts,
    evidence_sufficiency: diagnostics.score,
    source_independence: sourceIndependence,
    calibration_context: calibrationRows,
    model_provider: modelProvider ?? null,
    model_name: modelName ?? null,
    metadata,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { ctx, response } = await requireUser(req, corsHeaders);
  if (response || !ctx) return response ?? json({ error: "Unauthorized" }, 401);

  const authHeader = req.headers.get("authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const bodyUnknown: unknown = await req.json().catch(() => ({}));
  const body = isRecord(bodyUnknown) ? bodyUnknown : {};
  const requestedDivisions = sanitizeDivisions(body.divisions);
  const targetDivisions =
    requestedDivisions.length > 0 ? requestedDivisions : [...DEFAULT_DIVISIONS];
  const startTime = Date.now();

  try {
    const [
      recentEventsResult,
      anomaliesResult,
      crisesResult,
      threatsResult,
      defenseResult,
      normalizedEventsResult,
      graphResult,
      calibrationResult,
    ] = await Promise.all([
      userClient
        .from("intel_events")
        .select("id,division,event_type,title,severity,source_system,published_at")
        .in("division", targetDivisions)
        .order("published_at", { ascending: false })
        .limit(40),
      userClient
        .from("anomaly_detections")
        .select("id,division,anomaly_type,severity,status,detected_at")
        .in("division", targetDivisions)
        .eq("status", "active")
        .limit(40),
      userClient
        .from("crisis_events")
        .select("id,kind,region,severity,status,opened_at")
        .in("status", ["monitoring", "escalated"])
        .limit(40),
      userClient
        .from("threat_logs")
        .select("id,threat_type,severity,location,description,created_at")
        .eq("neutralized", false)
        .limit(40),
      userClient
        .from("defense_posture")
        .select("id,region,threat_level,updated_at")
        .order("threat_level", { ascending: false })
        .limit(20),
      userClient
        .from("normalized_events")
        .select(
          "id,provider_name,event_type,category,title,iso3,country_iso3,severity,confidence,provenance_source,source_name,occurred_at,started_at",
        )
        .not("provider_name", "like", "internal:%")
        .neq("provider_name", "aicis_signals")
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .limit(60),
      userClient
        .from("graph_relationship_current")
        .select(
          "relationship_key,subject_key,object_key,relation_type,direction,evidence_status,sample_size,method,confidence,decayed_weight",
        )
        .eq("evidence_status", "measured")
        .order("decayed_weight", { ascending: false, nullsFirst: false })
        .limit(120),
      userClient
        .from("forecast_calibration_context")
        .select("*")
        .in("domain", targetDivisions),
    ]);

    const recentEvents = asRows(recentEventsResult.data);
    const anomalies = asRows(anomaliesResult.data);
    const crises = asRows(crisesResult.data);
    const threats = asRows(threatsResult.data);
    const defensePosture = asRows(defenseResult.data);
    const normalizedEvents = asRows(normalizedEventsResult.data);
    const graphEdges = parseGraphEdges(graphResult.data, targetDivisions);
    const calibrationRows = parseCalibrationRows(calibrationResult.data);
    const providerLabels = providerLabelsFromRows(normalizedEvents, recentEvents);

    const evidenceCounts: EvidenceCounts = {
      recent_events: recentEvents.length,
      normalized_events: normalizedEvents.length,
      active_anomalies: anomalies.length,
      active_crises: crises.length,
      active_threats: threats.length,
      defense_posture_rows: defensePosture.length,
      measured_graph_edges: graphEdges.length,
    };

    const diagnostics = computeEvidenceDiagnostics(
      evidenceCounts,
      providerLabels.length,
      calibrationRows,
      targetDivisions.length,
    );

    const sourceIndependence: UnknownRecord = {
      distinct_provider_labels: providerLabels.length,
      provider_labels: providerLabels.slice(0, 30),
      ownership_independence_verified: false,
      caveat:
        "Distinct provider labels are not proof of independent ownership or original reporting.",
    };

    const evidenceTotal =
      evidenceCounts.recent_events +
      evidenceCounts.normalized_events +
      evidenceCounts.active_anomalies +
      evidenceCounts.active_crises +
      evidenceCounts.active_threats +
      evidenceCounts.defense_posture_rows;

    if (evidenceTotal === 0) {
      await recordAbstention({
        adminClient,
        userId: ctx.user.id,
        divisions: targetDivisions,
        reason: "No current evidence is available for a defensible forecast.",
        evidenceCounts,
        diagnostics,
        sourceIndependence,
        calibrationRows,
        metadata: { epistemic_version: "forecast-epistemics-v1" },
      });

      return json({
        success: true,
        abstained: true,
        reason: "No current evidence is available for a defensible forecast.",
        predictions: [],
        evidence_counts: evidenceCounts,
        evidence_diagnostics: diagnostics,
        execution_time_ms: Date.now() - startTime,
      });
    }

    const graphMap = new Map(
      graphEdges.map((edge) => [edge.relationshipKey, edge]),
    );

    const evidenceSnapshot = {
      target_divisions: targetDivisions,
      observed_event_grade_records: normalizedEvents,
      internal_intelligence_bus: recentEvents,
      active_anomalies: anomalies,
      active_crises: crises,
      active_threats: threats,
      defense_posture: defensePosture,
      measured_graph_relationships: graphEdges,
      calibration_context: calibrationRows,
      evidence_diagnostics: diagnostics,
      source_independence: sourceIndependence,
      data_gaps: [
        recentEventsResult.error?.message,
        anomaliesResult.error?.message,
        crisesResult.error?.message,
        threatsResult.error?.message,
        defenseResult.error?.message,
        normalizedEventsResult.error?.message,
        graphResult.error?.message,
        calibrationResult.error?.message,
      ].filter((message): message is string => Boolean(message)),
    };

    const aiResult = await aiChat({
      messages: [
        {
          role: "system",
          content:
            'You are AICIS Forecast Epistemics v1. Forecast only from the supplied evidence. Never invent incidents, measurements, base rates, causal links, source independence, intervention effects, or certainty. Base rates and calibration values may only come from calibration_context. Treat "distinct provider labels" as provider diversity, not proven independent reporting. Measured graph relationships may support structural or associative pathways; correlations must never be described as causation. If evidence is insufficient, return {"abstention_reason":"...","predictions":[]}. Otherwise return {"abstention_reason":null,"predictions":[...]}. Every prediction must include: title, affected_divisions, probability, probability_low, probability_high, impact_score, confidence_level, description, horizon_days, predicted_timeframe, indicators, assumptions, trigger_conditions, regime_context, graph_pathways, counterfactuals. probability/probability_low/probability_high/impact_score/confidence_level are model estimates from 0-100 and must not be omitted. probability_low <= probability <= probability_high. regime_context must be an explicitly derived hypothesis with label, rationale, evidence_refs, and confidence. graph_pathways must reference only supplied relationship_key values. counterfactuals must give intervention, direction (increase|decrease|uncertain), rationale, evidence_refs; do not invent numeric intervention effects.',
        },
        {
          role: "user",
          content: `Produce defensible forecasts for ${targetDivisions.join(
            ", ",
          )}.\n\nEvidence and calibration context:\n${JSON.stringify(
            evidenceSnapshot,
          ).slice(0, 32_000)}`,
        },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0.05,
      maxTokens: 2_800,
      timeoutMs: 20_000,
    });

    const parsedUnknown: unknown = JSON.parse(aiResult.content);
    const parsed = isRecord(parsedUnknown) ? parsedUnknown : {};
    const rawPredictions = Array.isArray(parsed.predictions)
      ? parsed.predictions.slice(0, 5)
      : [];
    const modelAbstentionReason = asText(parsed.abstention_reason, 2_000);
    const results: UnknownRecord[] = [];
    const rejectedPredictions: string[] = [];

    for (const rawPrediction of rawPredictions) {
      if (!isRecord(rawPrediction)) {
        rejectedPredictions.push("prediction_not_object");
        continue;
      }

      const title = asText(rawPrediction.title, 300);
      const description = asText(rawPrediction.description, 4_000);
      const probability = asNumberInRange(rawPrediction.probability, 0, 100);
      const probabilityLow = asNumberInRange(
        rawPrediction.probability_low,
        0,
        100,
      );
      const probabilityHigh = asNumberInRange(
        rawPrediction.probability_high,
        0,
        100,
      );
      const impactScore = asNumberInRange(rawPrediction.impact_score, 0, 100);
      const confidence = asNumberInRange(
        rawPrediction.confidence_level,
        0,
        100,
      );
      const horizonDays = asIntegerInRange(rawPrediction.horizon_days, 1, 3_650);
      const indicators = asTextArray(rawPrediction.indicators, 20, 700);
      const assumptions = asTextArray(rawPrediction.assumptions, 20, 700);
      const triggerConditions = asTextArray(
        rawPrediction.trigger_conditions,
        20,
        700,
      );
      const predictedTimeframe =
        asText(rawPrediction.predicted_timeframe, 200) ??
        (horizonDays !== null ? `${horizonDays} days` : null);
      const affectedDivisions = sanitizeDivisions(
        rawPrediction.affected_divisions,
      ).filter((division) => targetDivisions.includes(division));
      const scopedDivisions =
        affectedDivisions.length > 0 ? affectedDivisions : targetDivisions;

      if (
        !title ||
        !description ||
        probability === null ||
        probabilityLow === null ||
        probabilityHigh === null ||
        impactScore === null ||
        confidence === null ||
        horizonDays === null ||
        !predictedTimeframe ||
        indicators.length === 0
      ) {
        rejectedPredictions.push(
          title ? `${title}:missing_required_forecast_fields` : "missing_title",
        );
        continue;
      }

      if (
        probabilityLow > probability ||
        probabilityHigh < probability ||
        probabilityLow > probabilityHigh
      ) {
        rejectedPredictions.push(`${title}:invalid_uncertainty_interval`);
        continue;
      }

      const calibration = aggregateCalibration(
        calibrationRows,
        scopedDivisions,
      );
      const pathways = normalizePathways(
        rawPrediction.graph_pathways,
        graphMap,
      );
      const counterfactuals = normalizeCounterfactuals(
        rawPrediction.counterfactuals,
      );
      const regimeContext = isRecord(rawPrediction.regime_context)
        ? rawPrediction.regime_context
        : {};
      const horizonAt = new Date(
        Date.now() + horizonDays * DAY_MS,
      ).toISOString();
      const riskLevel = deriveRiskLevel(probability, impactScore);

      const { data: inserted, error: insertError } = await userClient
        .from("risk_predictions")
        .insert({
          prediction_type: "contextual_forecast_epistemics_v1",
          affected_divisions: scopedDivisions,
          risk_level: riskLevel,
          probability,
          impact_score: impactScore,
          title,
          description_md: description,
          indicators: {
            evidence_statements: indicators,
            evidence_counts: evidenceCounts,
            evidence_diagnostics: diagnostics,
            base_rate_context: {
              probability: calibration.baseRateProbability,
              sample_size: calibration.sampleSize,
              domains: calibration.domains,
            },
            probability_semantics:
              "model estimate conditioned on supplied evidence; not an observed fact",
          },
          mitigation_strategies_md: asText(
            rawPrediction.mitigation_strategies,
            4_000,
          ),
          predicted_timeframe: predictedTimeframe,
          confidence_level: confidence,
          model_version: `${aiResult.provider}:${aiResult.model}`,
          base_rate_probability: calibration.baseRateProbability,
          calibration_trust: calibration.calibrationTrust,
          calibration_sample_size: calibration.sampleSize,
          evidence_sufficiency: diagnostics.score,
          uncertainty_low: probabilityLow,
          uncertainty_high: probabilityHigh,
          forecast_horizon_at: horizonAt,
          regime_context: regimeContext,
          graph_pathways: pathways,
          counterfactuals,
          assumptions,
          trigger_conditions: triggerConditions,
          source_independence: sourceIndependence,
          forecast_status: "issued",
        })
        .select("*")
        .single();

      if (insertError || !inserted) {
        rejectedPredictions.push(`${title}:insert_failed`);
        continue;
      }

      const insertedRecord = isRecord(inserted) ? inserted : {};
      const predictionId = asText(insertedRecord.id, 64);
      if (predictionId) {
        const outcomePayload = {
          prediction_key: `risk_prediction:${predictionId}`,
          model_name: aiResult.provider,
          model_version: aiResult.model,
          predicted_probability: probability / 100,
          predicted_value: {
            risk_prediction_id: predictionId,
            title,
            affected_divisions: scopedDivisions,
            impact_score: impactScore,
            uncertainty_low: probabilityLow,
            uncertainty_high: probabilityHigh,
          },
          horizon_at: horizonAt,
          evidence_snapshot: {
            normalized_event_ids: normalizedEvents
              .map((row) => asText(row.id, 64))
              .filter((id): id is string => Boolean(id)),
            intel_event_ids: recentEvents
              .map((row) => asText(row.id, 64))
              .filter((id): id is string => Boolean(id)),
            evidence_counts: evidenceCounts,
            evidence_diagnostics: diagnostics,
            source_independence: sourceIndependence,
            base_rate_probability: calibration.baseRateProbability,
            calibration_sample_size: calibration.sampleSize,
          },
          graph_snapshot: {
            pathways,
            measured_relationship_keys: pathways.flatMap(
              (pathway) => pathway.relationship_keys,
            ),
          },
          metadata: {
            epistemic_version: "forecast-epistemics-v1",
            confidence_level: confidence,
            calibration_trust: calibration.calibrationTrust,
            regime_context: regimeContext,
            counterfactuals,
            assumptions,
            trigger_conditions: triggerConditions,
          },
        };

        const { data: outcomeRow, error: outcomeError } = await adminClient
          .from("aicis_prediction_outcomes")
          .insert(outcomePayload)
          .select("id")
          .single();

        if (!outcomeError && isRecord(outcomeRow)) {
          const outcomeId = asText(outcomeRow.id, 64);
          if (outcomeId) {
            await adminClient
              .from("risk_predictions")
              .update({ outcome_tracking_id: outcomeId })
              .eq("id", predictionId);
            insertedRecord.outcome_tracking_id = outcomeId;
          }
        }
      }

      results.push(insertedRecord);
    }

    if (results.length === 0) {
      const reason =
        modelAbstentionReason ??
        (rejectedPredictions.length > 0
          ? `No model output passed forecast validation: ${rejectedPredictions.join(
              "; ",
            )}`.slice(0, 2_000)
          : "Model returned no defensible forecast.");

      await recordAbstention({
        adminClient,
        userId: ctx.user.id,
        divisions: targetDivisions,
        reason,
        evidenceCounts,
        diagnostics,
        sourceIndependence,
        calibrationRows,
        modelProvider: aiResult.provider,
        modelName: aiResult.model,
        metadata: {
          epistemic_version: "forecast-epistemics-v1",
          rejected_predictions: rejectedPredictions,
        },
      });

      return json({
        success: true,
        abstained: true,
        reason,
        predictions: [],
        rejected_predictions: rejectedPredictions,
        evidence_counts: evidenceCounts,
        evidence_diagnostics: diagnostics,
        source_independence: sourceIndependence,
        model: aiResult.model,
        provider: aiResult.provider,
        execution_time_ms: Date.now() - startTime,
      });
    }

    const executionTime = Date.now() - startTime;

    await userClient.from("compliance_audit").insert({
      action_type: "risk_prediction",
      user_id: ctx.user.id,
      action_description: `Generated ${results.length} forecast-epistemics-v1 predictions`,
      compliance_status: "compliant",
      data_accessed: {
        internal_policy: "forecast_epistemics_v1",
        external_legal_compliance_assessed: false,
        divisions: targetDivisions,
        evidence_counts: evidenceCounts,
        evidence_sufficiency: diagnostics.score,
        model: aiResult.model,
        provider: aiResult.provider,
      },
    });

    await userClient.from("system_logs").insert({
      action: "risk_prediction",
      division: "system",
      user_id: ctx.user.id,
      log_level: "info",
      result: `Generated ${results.length} context-aware forecasts`,
      metadata: {
        divisions: targetDivisions,
        evidence_counts: evidenceCounts,
        evidence_sufficiency: diagnostics.score,
        execution_time_ms: executionTime,
        model: aiResult.model,
        provider: aiResult.provider,
        epistemic_version: "forecast-epistemics-v1",
      },
    });

    return json({
      success: true,
      abstained: false,
      message: `Generated ${results.length} context-aware, evidence-grounded forecasts`,
      predictions: results,
      rejected_predictions: rejectedPredictions,
      evidence_counts: evidenceCounts,
      evidence_diagnostics: diagnostics,
      source_independence: sourceIndependence,
      calibration_context: calibrationRows,
      model: aiResult.model,
      provider: aiResult.provider,
      execution_time_ms: executionTime,
    });
  } catch (error) {
    console.error("Risk prediction error:", error);
    return json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});
