import {
  AiSovereigntyPolicyError,
  evaluateAiRoute,
  parseSovereignHostAllowlist,
} from "./ai-sovereignty.mjs";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatRequest {
  messages: AiMessage[];
  model?: string;
  responseFormat?: { type: "json_object" };
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AiRouteMetadata {
  policy_version: string;
  mode: "sovereign" | "hybrid" | "research";
  endpoint_host: string;
  endpoint_protocol: "http" | "https";
  trust_class: "local_or_private" | "sovereign_allowlisted" | "external";
  external_network_allowed: boolean;
}

export interface AiChatResult {
  content: string;
  model: string;
  provider: string;
  route: AiRouteMetadata;
  raw: Record<string, unknown>;
}

interface OpenAiCompatibleResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  [key: string]: unknown;
}

export class AiProviderError extends Error {
  status?: number;
  provider: string;
  code: string;

  constructor(message: string, provider: string, status?: number, code = "ai_provider_error") {
    super(message);
    this.name = "AiProviderError";
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * AICIS provider-neutral, OpenAI-compatible model gateway.
 *
 * Sovereignty invariants:
 * - There is no implicit external provider or model fallback.
 * - AICIS_AI_MODE, AICIS_MODEL_ENDPOINT, and AICIS_MODEL_NAME are explicit.
 * - sovereign mode permits only local/private or explicitly allowlisted hosts.
 * - sovereign mode never silently falls back to an external provider.
 * - public sovereign endpoints require authentication.
 * - provider credentials are read from server-side secrets only and are never
 *   returned in route telemetry.
 *
 * Configuration:
 *   AICIS_AI_MODE                 sovereign | hybrid | research
 *   AICIS_MODEL_ENDPOINT          explicit OpenAI-compatible chat endpoint
 *   AICIS_MODEL_NAME              explicit model identifier
 *   AICIS_MODEL_PROVIDER          optional telemetry label
 *   AICIS_MODEL_API_KEY           optional for local/private endpoints;
 *                                 required for public sovereign endpoints
 *   AICIS_SOVEREIGN_MODEL_HOSTS   comma-separated exact hosts or *.suffixes
 */
export async function aiChat(request: AiChatRequest): Promise<AiChatResult> {
  const mode = Deno.env.get("AICIS_AI_MODE")?.trim();
  const endpoint = Deno.env.get("AICIS_MODEL_ENDPOINT")?.trim();
  const apiKey = Deno.env.get("AICIS_MODEL_API_KEY")?.trim();
  const configuredModel = Deno.env.get("AICIS_MODEL_NAME")?.trim();
  const sovereignHosts = parseSovereignHostAllowlist(
    Deno.env.get("AICIS_SOVEREIGN_MODEL_HOSTS"),
  );

  if (!configuredModel) {
    throw new AiProviderError(
      "AICIS_MODEL_NAME must be explicitly configured",
      "unconfigured",
      undefined,
      "model_name_missing",
    );
  }

  let route: AiRouteMetadata;
  try {
    route = evaluateAiRoute({
      mode,
      endpoint,
      sovereignHosts,
      apiKeyPresent: Boolean(apiKey),
    }) as AiRouteMetadata;
  } catch (error) {
    if (error instanceof AiSovereigntyPolicyError) {
      throw new AiProviderError(
        error.message,
        "policy",
        undefined,
        error.code,
      );
    }
    throw error;
  }

  const provider = Deno.env.get("AICIS_MODEL_PROVIDER")?.trim() || route.endpoint_host;
  const model = request.model?.trim() || configuredModel;
  if (!model) {
    throw new AiProviderError("AI model identifier is empty", provider, undefined, "model_name_empty");
  }

  const body: Record<string, unknown> = {
    model,
    messages: request.messages,
  };

  if (request.responseFormat) body.response_format = request.responseFormat;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;

  const timeoutMs = Math.max(1000, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(endpoint!, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AiProviderError(
      `AI provider request failed before response: ${message}`,
      provider,
      undefined,
      "provider_request_failed",
    );
  }

  if (!response.ok) {
    const detail = sanitizeProviderErrorDetail(await response.text());
    throw new AiProviderError(
      `AI provider request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      provider,
      response.status,
      "provider_http_error",
    );
  }

  const raw = (await response.json()) as OpenAiCompatibleResponse;
  const content = raw.choices?.[0]?.message?.content;
  if (!content) {
    throw new AiProviderError(
      "AI provider returned no message content",
      provider,
      undefined,
      "provider_content_missing",
    );
  }

  return {
    content,
    model: raw.model || model,
    provider,
    route,
    raw,
  };
}

function sanitizeProviderErrorDetail(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key["'\s:=]+)[^\s,"'}]+/gi, "$1[REDACTED]")
    .slice(0, 500);
}
