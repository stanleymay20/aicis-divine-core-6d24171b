import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const FN = "cognitive-causal-cascade-scan";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Relationship = {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: number | null;
  confidence: number;
};

type Claim = {
  id: string;
  epistemic_status: string;
  confidence: number;
  occurred_at: string | null;
  valid_from: string | null;
  source_id: string;
  source_type: string;
  metadata: Record<string, unknown> | null;
};

type RelationshipEvidence = {
  relationship_id: string;
  claim_id: string;
  stance: "supports" | "contradicts" | "context";
  weight: number;
};

type Assessment = {
  verdict: string;
  causal_score: number;
  confidence: number;
  temporal_precedence: number;
  mechanism_support: number;
  evidence_diversity: number;
  contradiction_penalty: number;
  confounder_penalty: number;
  intervention_support: number;
  counterfactual_support: number;
  supporting_claim_ids: string[];
  contradicting_claim_ids: string[];
  mechanism_claim_ids: string[];
  confounder_claim_ids: string[];
  reasons: string[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });

  const { user, via, response } = await requireAdminOrCron(req, corsHeaders);
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const maxRelationships = Math.min(5000, Math.max(1, Number(body?.max_relationships ?? 1000)));
  const maxCascadeHops = Math.min(8, Math.max(2, Number(body?.max_cascade_hops ?? 5)));
  const minCausalScore = clamp01(Number(body?.min_causal_score ?? 0.55));

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: relationships, error: relationshipError } = await supabase
    .from("aicis_world_relationships")
    .select("id,source_entity_id,target_entity_id,relationship_type,strength,confidence")
    .eq("status", "verified")
    .not("epistemic_status", "in", '("unverified","contradicted")')
    .order("confidence", { ascending: false })
    .limit(maxRelationships);

  if (relationshipError) return json({ error: "Failed to load verified relationships" }, 500);
  const edges = (relationships ?? []) as Relationship[];
  if (edges.length === 0) return json({ success: true, relationships_scanned: 0, cascades: 0 });

  const relationshipIds = edges.map((edge) => edge.id);
  const { data: links, error: linkError } = await supabase
    .from("aicis_relationship_evidence")
    .select("relationship_id,claim_id,stance,weight")
    .in("relationship_id", relationshipIds);
  if (linkError) return json({ error: "Failed to load relationship evidence" }, 500);

  const evidenceLinks = (links ?? []) as RelationshipEvidence[];
  const claimIds = [...new Set(evidenceLinks.map((link) => link.claim_id))];
  let claims: Claim[] = [];
  if (claimIds.length > 0) {
    for (const chunk of chunkArray(claimIds, 400)) {
      const { data, error } = await supabase
        .from("aicis_evidence_claims")
        .select("id,epistemic_status,confidence,occurred_at,valid_from,source_id,source_type,metadata")
        .in("id", chunk);
      if (error) return json({ error: "Failed to load evidence claims" }, 500);
      claims.push(...((data ?? []) as Claim[]));
    }
  }

  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const linksByRelationship = new Map<string, RelationshipEvidence[]>();
  for (const link of evidenceLinks) push(linksByRelationship, link.relationship_id, link);

  const assessmentByRelationship = new Map<string, Assessment>();
  let causalSupported = 0;
  let mechanisticallySupported = 0;

  for (const relationship of edges) {
    const relatedLinks = linksByRelationship.get(relationship.id) ?? [];
    const assessment = assess(relationship, relatedLinks, claimById);
    assessmentByRelationship.set(relationship.id, assessment);

    if (assessment.verdict === "causally-supported") causalSupported++;
    if (assessment.verdict === "mechanistically-supported") mechanisticallySupported++;

    const { error } = await supabase.from("aicis_causal_assessments").insert({
      relationship_id: relationship.id,
      ...assessment,
      reasons: assessment.reasons,
      method: "aicis-evidence-causal-v1",
      metadata: { scanner: FN, auth_via: via },
    });
    if (error) {
      console.error(JSON.stringify({ level: "warn", function: FN, message: "assessment_insert_failed", relationship_id: relationship.id, error: error.message }));
    }
  }

  const causalEdges = edges.filter((edge) => {
    const assessment = assessmentByRelationship.get(edge.id);
    return Boolean(
      assessment &&
      assessment.causal_score >= minCausalScore &&
      (assessment.verdict === "mechanistically-supported" || assessment.verdict === "causally-supported")
    );
  });

  const { data: latestSnapshot } = await supabase
    .from("aicis_graph_snapshots")
    .select("id,captured_at")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const adjacency = new Map<string, Relationship[]>();
  for (const edge of causalEdges) push(adjacency, edge.source_entity_id, edge);

  const cascadeCandidates = detectCascades(causalEdges, adjacency, assessmentByRelationship, maxCascadeHops)
    .filter((candidate) => candidate.hops >= 2 && candidate.systemic_score >= 0.45)
    .sort((a, b) => b.systemic_score - a.systemic_score)
    .slice(0, 100);

  let cascadesPersisted = 0;
  let supportedCascades = 0;
  for (const candidate of cascadeCandidates) {
    const status = candidate.causal_confidence >= 0.45 && candidate.weakest_causal_score >= 0.6
      ? "supported"
      : "candidate";
    if (status === "supported") supportedCascades++;

    const cascadeKey = await sha256Hex(candidate.node_ids.join("→"));
    const { data: cascade, error: cascadeError } = await supabase
      .from("aicis_cascades")
      .upsert({
        cascade_key: cascadeKey,
        origin_entity_id: candidate.node_ids[0],
        terminal_entity_id: candidate.node_ids[candidate.node_ids.length - 1],
        status,
        epistemic_status: status === "supported" ? "inferred" : "derived",
        systemic_score: candidate.systemic_score,
        structural_confidence: candidate.structural_confidence,
        causal_confidence: candidate.causal_confidence,
        hop_count: candidate.hops,
        cross_domain_count: 0,
        last_detected_at: new Date().toISOString(),
        graph_snapshot_id: latestSnapshot?.id ?? null,
        provenance: latestSnapshot ? [{
          sourceId: `graph-snapshot:${latestSnapshot.id}`,
          sourceType: "derived-verified-graph",
          observedAt: latestSnapshot.captured_at,
          extractor: FN,
          extractorVersion: "1",
        }] : [],
        metadata: {
          node_ids: candidate.node_ids,
          weakest_causal_score: candidate.weakest_causal_score,
          note: "Cascade support requires every traversed relationship to meet causal evidence thresholds.",
        },
      }, { onConflict: "cascade_key,graph_snapshot_id" })
      .select("id")
      .single();

    if (cascadeError || !cascade) continue;
    cascadesPersisted++;

    await supabase.from("aicis_cascade_steps").delete().eq("cascade_id", cascade.id);
    const stepRows = candidate.steps.map((step: any, index: number) => ({
      cascade_id: cascade.id,
      step_index: index,
      relationship_id: step.relationship.id,
      source_entity_id: step.relationship.source_entity_id,
      target_entity_id: step.relationship.target_entity_id,
      structural_confidence: step.structural_confidence,
      cumulative_confidence: step.cumulative_confidence,
    }));
    if (stepRows.length > 0) await supabase.from("aicis_cascade_steps").insert(stepRows);

    if (status === "supported" && candidate.systemic_score >= 0.65) {
      await supabase.from("aicis_cognitive_events").insert({
        event_type: "cascade.detected",
        epistemic_status: "inferred",
        confidence: candidate.causal_confidence,
        subject_entity_id: candidate.node_ids[0],
        occurred_at: new Date().toISOString(),
        producer: FN,
        payload: {
          cascade_id: cascade.id,
          node_ids: candidate.node_ids,
          hops: candidate.hops,
          systemic_score: candidate.systemic_score,
          causal_confidence: candidate.causal_confidence,
          weakest_causal_score: candidate.weakest_causal_score,
        },
        provenance: latestSnapshot ? [{
          sourceId: `graph-snapshot:${latestSnapshot.id}`,
          sourceType: "derived-verified-graph",
          observedAt: latestSnapshot.captured_at,
          extractor: FN,
          extractorVersion: "1",
        }] : [],
      });
    }
  }

  await supabase.from("system_logs").insert({
    action: "cognitive_causal_cascade_scan",
    user_id: user?.id ?? null,
    log_level: "info",
    result: `Assessed ${edges.length} relationships and persisted ${cascadesPersisted} cascade candidates`,
    metadata: {
      auth_via: via,
      relationships_scanned: edges.length,
      causal_supported: causalSupported,
      mechanistically_supported: mechanisticallySupported,
      causal_edges: causalEdges.length,
      cascades_persisted: cascadesPersisted,
      supported_cascades: supportedCascades,
    },
  });

  return json({
    success: true,
    relationships_scanned: edges.length,
    causal_supported: causalSupported,
    mechanistically_supported: mechanisticallySupported,
    causal_edges: causalEdges.length,
    cascades_persisted: cascadesPersisted,
    supported_cascades: supportedCascades,
  });
});

function assess(
  relationship: Relationship,
  links: RelationshipEvidence[],
  claimById: Map<string, Claim>,
): Assessment {
  const supports = links.filter((link) => link.stance === "supports").map((link) => claimById.get(link.claim_id)).filter(Boolean) as Claim[];
  const contradicts = links.filter((link) => link.stance === "contradicts").map((link) => claimById.get(link.claim_id)).filter(Boolean) as Claim[];
  const context = links.filter((link) => link.stance === "context").map((link) => claimById.get(link.claim_id)).filter(Boolean) as Claim[];

  const mechanisms = supports.filter((claim) => role(claim) === "mechanism");
  const interventions = supports.filter((claim) => role(claim) === "intervention");
  const counterfactuals = supports.filter((claim) => role(claim) === "counterfactual");
  const confounders = context.filter((claim) => role(claim) === "confounder");
  const temporal = supports.filter((claim) => Boolean(claim.occurred_at || claim.valid_from));

  const baseSupport = weightedSupport(supports);
  const evidenceDiversity = diversity(supports);
  const temporalPrecedence = supports.length === 0 ? 0 : clamp01(0.65 * temporal.length / supports.length + 0.35 * trustedFraction(temporal));
  const mechanismSupport = weightedSupport(mechanisms);
  const interventionSupport = weightedSupport(interventions);
  const counterfactualSupport = weightedSupport(counterfactuals);
  const contradictionPenalty = weightedSupport(contradicts);
  const confounderPenalty = weightedSupport(confounders);

  const causalScore = clamp01(
    0.2 * baseSupport +
    0.15 * evidenceDiversity +
    0.18 * temporalPrecedence +
    0.17 * mechanismSupport +
    0.15 * interventionSupport +
    0.15 * counterfactualSupport -
    0.18 * contradictionPenalty -
    0.14 * confounderPenalty,
  );
  const confidence = clamp01(
    0.45 * causalScore +
    0.25 * clamp01(relationship.confidence) +
    0.15 * evidenceDiversity +
    0.15 * Math.min(1, supports.length / 5),
  );

  let verdict = "insufficient-evidence";
  if (contradictionPenalty >= 0.75 && causalScore < 0.35) verdict = "contradicted";
  else if (supports.length < 2 || confidence < 0.35) verdict = "insufficient-evidence";
  else if (causalScore < 0.45) verdict = "associated";
  else if (temporalPrecedence >= 0.55 && causalScore < 0.62) verdict = "temporally-plausible";
  else if (temporalPrecedence >= 0.55 && mechanismSupport >= 0.55 && causalScore < 0.78) verdict = "mechanistically-supported";
  else if (
    causalScore >= 0.78 && temporalPrecedence >= 0.65 && mechanismSupport >= 0.6 &&
    (interventionSupport >= 0.45 || counterfactualSupport >= 0.45) && contradictionPenalty < 0.5
  ) verdict = "causally-supported";
  else verdict = "mechanistically-supported";

  const reasons: string[] = [];
  if (supports.length === 0) reasons.push("No supporting evidence claims are attached");
  if (temporalPrecedence >= 0.6) reasons.push("Temporal evidence is consistent with cause preceding effect");
  if (mechanismSupport >= 0.6) reasons.push("Mechanism evidence supports the relationship");
  if (contradictionPenalty >= 0.4) reasons.push("Material contradictory evidence exists");
  if (confounderPenalty >= 0.4) reasons.push("Material confounding explanations remain");
  if (reasons.length === 0) reasons.push("Evidence remains mixed or incomplete");

  return {
    verdict,
    causal_score: causalScore,
    confidence,
    temporal_precedence: temporalPrecedence,
    mechanism_support: mechanismSupport,
    evidence_diversity: evidenceDiversity,
    contradiction_penalty: contradictionPenalty,
    confounder_penalty: confounderPenalty,
    intervention_support: interventionSupport,
    counterfactual_support: counterfactualSupport,
    supporting_claim_ids: supports.map((claim) => claim.id),
    contradicting_claim_ids: contradicts.map((claim) => claim.id),
    mechanism_claim_ids: mechanisms.map((claim) => claim.id),
    confounder_claim_ids: confounders.map((claim) => claim.id),
    reasons,
  };
}

function detectCascades(
  edges: Relationship[],
  adjacency: Map<string, Relationship[]>,
  assessments: Map<string, Assessment>,
  maxHops: number,
) {
  const results: any[] = [];
  const origins = [...new Set(edges.map((edge) => edge.source_entity_id))];

  for (const origin of origins) {
    const stack: any[] = [{ current: origin, node_ids: [origin], steps: [], structural: 1, causal: 1, weakest: 1, strength_sum: 0 }];
    while (stack.length > 0 && results.length < 500) {
      const frame = stack.pop();
      if (!frame || frame.steps.length >= maxHops) continue;
      for (const edge of adjacency.get(frame.current) ?? []) {
        if (frame.node_ids.includes(edge.target_entity_id)) continue;
        const assessment = assessments.get(edge.id);
        if (!assessment) continue;
        const edgeStructural = clamp01(edge.confidence * (edge.strength ?? edge.confidence));
        const structural = frame.structural * edgeStructural;
        const causal = frame.causal * assessment.confidence;
        const weakest = Math.min(frame.weakest, assessment.causal_score);
        if (structural < 0.08 || causal < 0.08) continue;

        const steps = [...frame.steps, {
          relationship: edge,
          structural_confidence: edgeStructural,
          cumulative_confidence: structural,
        }];
        const nodeIds = [...frame.node_ids, edge.target_entity_id];
        const strengthSum = frame.strength_sum + clamp01(edge.strength ?? edge.confidence);
        const avgStrength = strengthSum / steps.length;
        const systemicScore = clamp01(0.35 * structural + 0.25 * causal + 0.2 * avgStrength + 0.2 * clamp01(steps.length / maxHops));

        results.push({
          node_ids: nodeIds,
          steps,
          hops: steps.length,
          structural_confidence: structural,
          causal_confidence: causal,
          weakest_causal_score: weakest,
          systemic_score: systemicScore,
        });
        stack.push({ current: edge.target_entity_id, node_ids: nodeIds, steps, structural, causal, weakest, strength_sum: strengthSum });
      }
    }
  }
  return results;
}

function role(claim: Claim): string {
  return String(claim.metadata?.evidence_role ?? claim.metadata?.role ?? "").toLowerCase();
}

function weightedSupport(claims: Claim[]): number {
  if (claims.length === 0) return 0;
  const total = claims.reduce((sum, claim) => {
    const statusWeight = claim.epistemic_status === "observed" ? 1 : claim.epistemic_status === "derived" ? 0.9 : claim.epistemic_status === "inferred" ? 0.75 : 0.25;
    return sum + clamp01(claim.confidence) * statusWeight;
  }, 0);
  return clamp01(total / Math.min(3, claims.length));
}

function diversity(claims: Claim[]): number {
  const ids = new Set(claims.map((claim) => claim.source_id.toLowerCase()));
  const types = new Set(claims.map((claim) => claim.source_type.toLowerCase()));
  return clamp01(0.7 * Math.min(1, ids.size / 4) + 0.3 * Math.min(1, types.size / 3));
}

function trustedFraction(claims: Claim[]): number {
  if (claims.length === 0) return 0;
  return claims.filter((claim) => claim.epistemic_status === "observed" || claim.epistemic_status === "derived").length / claims.length;
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}
