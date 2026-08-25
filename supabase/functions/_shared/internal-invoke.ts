type InvokeResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
};

export async function invokeInternalFunction<T = unknown>(
  functionName: string,
  body: unknown = {},
  timeoutMs = 45_000,
): Promise<InvokeResult<T>> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";

  if (!supabaseUrl || !anonKey || !cronSecret) {
    return {
      ok: false,
      status: 503,
      data: null,
      error: "Internal invocation configuration is incomplete",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${encodeURIComponent(functionName)}`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "x-cron-secret": cronSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    const text = await response.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? null : `Internal function ${functionName} returned HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
