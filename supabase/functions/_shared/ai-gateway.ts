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

export interface AiChatResult {
  content: string;
  model: string;
  provider: string;
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

  constructor(message: string, provider: string, status?: number) {
    super(message);
    this.name = "AiProviderError";
    this.provider = provider;
    this.status = status;
  }
}

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Provider-neutral OpenAI-compatible gateway for AICIS Edge Functions.
 *
 * Required secret:
 *   AICIS_MODEL_API_KEY
 * Optional secrets:
 *   AICIS_MODEL_ENDPOINT (defaults to OpenAI chat completions)
 *   AICIS_MODEL_NAME     (defaults to gpt-4o-mini)
 *   AICIS_MODEL_PROVIDER (for telemetry only)
 *
 * No function should depend directly on Lovable billing or a Lovable-specific
 * model gateway. A different OpenAI-compatible provider can be selected by
 * changing secrets, without editing individual functions.
 */
export async function aiChat(request: AiChatRequest): Promise<AiChatResult> {
  const endpoint = Deno.env.get("AICIS_MODEL_ENDPOINT")?.trim() || DEFAULT_ENDPOINT;
  const apiKey = Deno.env.get("AICIS_MODEL_API_KEY")?.trim();
  const configuredModel = Deno.env.get("AICIS_MODEL_NAME")?.trim() || DEFAULT_MODEL;
  const provider = Deno.env.get("AICIS_MODEL_PROVIDER")?.trim() || inferProvider(endpoint);

  if (!apiKey) {
    throw new AiProviderError("AICIS_MODEL_API_KEY is not configured", provider);
  }

  const model = request.model?.trim() || configuredModel;
  const body: Record<string, unknown> = {
    model,
    messages: request.messages,
  };

  if (request.responseFormat) body.response_format = request.responseFormat;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;

  const timeoutMs = Math.max(1000, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AiProviderError(`AI provider request failed before response: ${message}`, provider);
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new AiProviderError(`AI provider request failed (${response.status}): ${detail}`, provider, response.status);
  }

  const raw = (await response.json()) as OpenAiCompatibleResponse;
  const content = raw.choices?.[0]?.message?.content;
  if (!content) {
    throw new AiProviderError("AI provider returned no message content", provider);
  }

  return {
    content,
    model: raw.model || model,
    provider,
    raw,
  };
}

function inferProvider(endpoint: string): string {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    if (host.includes("openai.com")) return "openai";
    if (host.includes("anthropic.com")) return "anthropic-compatible";
    if (host.includes("googleapis.com")) return "google-compatible";
    return host;
  } catch {
    return "custom";
  }
}
