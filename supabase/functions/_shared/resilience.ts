/**
 * AICIS Shared Resilience Module
 * Circuit breaker, retry, timeout, and structured logging for all edge functions.
 * Import via: import { resilientCall, structuredLog, timeoutWrapper } from './resilience.ts'
 */

// ─── Circuit Breaker ────────────────────────────────────────────────

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

const circuits = new Map<string, CircuitState>();
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 60_000; // 60s half-open cooldown

function isCircuitOpen(key: string): boolean {
  const s = circuits.get(key);
  if (!s || !s.open) return false;
  if (Date.now() - s.lastFailure > CIRCUIT_RESET_MS) {
    s.open = false;
    s.failures = 0;
    return false;
  }
  return true;
}

function recordSuccess(key: string): void {
  circuits.set(key, { failures: 0, lastFailure: 0, open: false });
}

function recordFailure(key: string): void {
  const s = circuits.get(key) || { failures: 0, lastFailure: 0, open: false };
  s.failures += 1;
  s.lastFailure = Date.now();
  if (s.failures >= CIRCUIT_THRESHOLD) s.open = true;
  circuits.set(key, s);
}

// ─── Retry with Exponential Backoff ─────────────────────────────────

export async function retryWithBackoff<T>(
  fn: () => Promise<T> | PromiseLike<T>,
  maxRetries: number = 2,
  baseDelayMs: number = 400,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ─── Timeout Wrapper ────────────────────────────────────────────────

export async function timeoutWrapper<T>(
  fn: () => Promise<T> | PromiseLike<T>,
  timeoutMs: number = 25000,
  label: string = 'operation',
): Promise<T> {
  return Promise.race([
    Promise.resolve(fn()),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// ─── Resilient Call (Circuit Breaker + Retry + Timeout) ─────────────

export async function resilientCall<T>(
  key: string,
  fn: () => Promise<T> | PromiseLike<T>,
  options: { maxRetries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const { maxRetries = 2, timeoutMs = 25000 } = options;

  if (isCircuitOpen(key)) {
    throw new Error(`Circuit open for ${key} — service temporarily unavailable`);
  }

  try {
    const result = await retryWithBackoff(
      () => timeoutWrapper(fn, timeoutMs, key),
      maxRetries,
    );
    recordSuccess(key);
    return result;
  } catch (err) {
    recordFailure(key);
    throw err;
  }
}

// ─── Structured Logger ──────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  function: string;
  message: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export function structuredLog(
  level: LogLevel,
  functionName: string,
  message: string,
  metadata?: Record<string, unknown>,
  startTime?: number,
): void {
  const entry: LogEntry = {
    level,
    function: functionName,
    message,
    timestamp: new Date().toISOString(),
  };
  if (startTime) entry.duration_ms = Date.now() - startTime;
  if (metadata) entry.metadata = metadata;

  const output = JSON.stringify(entry);
  switch (level) {
    case 'error': console.error(output); break;
    case 'warn': console.warn(output); break;
    case 'debug': console.debug(output); break;
    default: console.log(output);
  }
}

// ─── CORS Headers (shared) ──────────────────────────────────────────

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

// ─── Error Response Helper ──────────────────────────────────────────

export function errorResponse(error: unknown, status: number = 500): Response {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(
    JSON.stringify(data),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
