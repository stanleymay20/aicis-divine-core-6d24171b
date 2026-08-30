import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminUser } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody =
  | {
      operation: "seal_target";
      prediction_id: string;
      target_definition: string;
      target_semantics: string;
      target_version: string;
      resolution_rule: string;
      resolution_rule_version: string;
      forecast_horizon_at?: string | null;
    }
  | {
      operation: "create_artifact";
      artifact_type: string;
      media_type: string;
      canonical_evidence: Record<string, unknown>;
    }
  | {
      operation: "record_evidence";
      prediction_id: string;
      evidence_artifact_id: string;
      event_type: string;
      observed_at: string;
      observation_text: string;
      source_name: string;
      source_uri: string;
      ledger_id?: string | null;
    }
  | {
      operation: "verify_evidence";
      external_outcome_id: string;
      verification_method: string;
    }
  | {
      operation: "resolve_outcome";
      external_outcome_id: string;
      resolved_binary_outcome: 0 | 1;
      resolution_evidence?: Record<string, unknown>;
    };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const auth = await requireAdminUser(req, cors);
  if (auth.response) return auth.response;

  try {
    const body = (await req.json()) as RequestBody;
    if (!body || typeof body !== "object" || !("operation" in body)) {
      throw new Error("operation is required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    switch (body.operation) {
      case "seal_target": {
        requireText(body.prediction_id, "prediction_id");
        requireText(body.target_definition, "target_definition");
        requireText(body.target_semantics, "target_semantics");
        requireText(body.target_version, "target_version");
        requireText(body.resolution_rule, "resolution_rule");
        requireText(body.resolution_rule_version, "resolution_rule_version");
        if (body.forecast_horizon_at != null) requireTimestamp(body.forecast_horizon_at, "forecast_horizon_at");

        const { data, error } = await supabase.rpc("seal_aicis_model_prediction_target_v7", {
          p_prediction_id: body.prediction_id,
          p_target_definition: body.target_definition,
          p_target_semantics: body.target_semantics,
          p_target_version: body.target_version,
          p_resolution_rule: body.resolution_rule,
          p_resolution_rule_version: body.resolution_rule_version,
          p_forecast_horizon_at: body.forecast_horizon_at ?? null,
        });
        if (error) throw error;
        return json({ operation: body.operation, result: data });
      }

      case "create_artifact": {
        requireText(body.artifact_type, "artifact_type");
        requireText(body.media_type, "media_type");
        if (!body.canonical_evidence || typeof body.canonical_evidence !== "object" || Array.isArray(body.canonical_evidence)) {
          throw new Error("canonical_evidence must be an object");
        }

        const { data, error } = await supabase.rpc("create_aicis_prediction_evidence_artifact_v7", {
          p_artifact_type: body.artifact_type,
          p_media_type: body.media_type,
          p_canonical_evidence: body.canonical_evidence,
        });
        if (error) throw error;
        return json({ operation: body.operation, result: data });
      }

      case "record_evidence": {
        requireText(body.prediction_id, "prediction_id");
        requireUuid(body.evidence_artifact_id, "evidence_artifact_id");
        requireText(body.event_type, "event_type");
        requireTimestamp(body.observed_at, "observed_at");
        requireText(body.observation_text, "observation_text");
        requireText(body.source_name, "source_name");
        requireText(body.source_uri, "source_uri");

        const { data, error } = await supabase.rpc("record_aicis_model_external_evidence_v7", {
          p_prediction_id: body.prediction_id,
          p_evidence_artifact_id: body.evidence_artifact_id,
          p_event_type: body.event_type,
          p_observed_at: body.observed_at,
          p_observation_text: body.observation_text,
          p_source_name: body.source_name,
          p_source_uri: body.source_uri,
          p_ledger_id: body.ledger_id ?? null,
        });
        if (error) throw error;
        return json({ operation: body.operation, result: data });
      }

      case "verify_evidence": {
        requireUuid(body.external_outcome_id, "external_outcome_id");
        requireText(body.verification_method, "verification_method");
        await requireWorkflowRole(supabase, auth.user.id, "evidence_verifier");

        const { data, error } = await supabase.rpc("verify_aicis_model_external_evidence_v9", {
          p_external_outcome_id: body.external_outcome_id,
          p_verification_method: body.verification_method,
          p_actor_user_id: auth.user.id,
        });
        if (error) throw error;
        return json({ operation: body.operation, result: data });
      }

      case "resolve_outcome": {
        requireUuid(body.external_outcome_id, "external_outcome_id");
        if (body.resolved_binary_outcome !== 0 && body.resolved_binary_outcome !== 1) {
          throw new Error("resolved_binary_outcome must be 0 or 1");
        }
        await requireWorkflowRole(supabase, auth.user.id, "outcome_resolver");

        const { data, error } = await supabase.rpc("resolve_aicis_model_outcome_v9", {
          p_external_outcome_id: body.external_outcome_id,
          p_resolved_binary_outcome: body.resolved_binary_outcome,
          p_actor_user_id: auth.user.id,
          p_resolution_evidence: body.resolution_evidence ?? {},
        });
        if (error) throw error;
        return json({ operation: body.operation, result: data });
      }

      default:
        throw new Error("unsupported operation");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "evidence governance operation failed";
    const status = message.startsWith("workflow role ") ? 403 : 400;
    return json({ error: message }, status);
  }
});

async function requireWorkflowRole(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  role: "evidence_verifier" | "outcome_resolver",
): Promise<void> {
  const { data, error } = await supabase.rpc("aicis_user_has_model_evidence_workflow_role_v7", {
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw error;
  if (data !== true) throw new Error(`workflow role ${role} is required`);
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
}

function requireTimestamp(value: unknown, field: string): asserts value is string {
  requireText(value, field);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be a valid timestamp`);
}

function requireUuid(value: unknown, field: string): asserts value is string {
  requireText(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
}

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extraHeaders, "content-type": "application/json" },
  });
}
