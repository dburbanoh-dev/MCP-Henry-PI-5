import { AppError, GitHubAPIError, toAppError, type ErrorContext } from "../errors/index.js";
import { logger } from "./logging.js";

/**
 * Reintentos con exponential backoff.
 *
 * Solo se reintentan errores temporales (red, 5xx y rate limit).
 * Un 404 o un 401 no se arreglan esperando, así que fallan de inmediato.
 *
 * Espera entre intentos: baseDelayMs * 2^intento (+ jitter aleatorio),
 * con tope en maxDelayMs. Si GitHub indica cuánto esperar (rate limit),
 * se respeta ese tiempo, salvo que supere maxDelayMs: en ese caso no tiene
 * sentido bloquear al agente y se devuelve el error con el tiempo de espera.
 */

export interface RetryOptions {
  /** Reintentos después del primer intento. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Contexto para los mensajes de error (owner, repo, operation). */
  context?: ErrorContext;
  /** Inyectable para tests: evita esperas reales. */
  sleep?: (ms: number) => Promise<void>;
  /** Inyectable para tests: hace el jitter determinista. */
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Calcula cuánto esperar antes del siguiente intento (attempt empieza en 0). */
export function computeDelay(
  attempt: number,
  error: AppError,
  { baseDelayMs = 500, maxDelayMs = 10_000, random = Math.random }: RetryOptions = {},
): number {
  if (error instanceof GitHubAPIError && error.retryAfterMs !== undefined) {
    return error.retryAfterMs;
  }
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = random() * baseDelayMs;
  return Math.min(exponential + jitter, maxDelayMs);
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, maxDelayMs = 10_000, context, sleep = defaultSleep } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (raw) {
      const error = toAppError(raw, context);
      const delay = computeDelay(attempt, error, options);

      if (!error.retryable || attempt >= retries || delay > maxDelayMs) {
        logger.error("Operación fallida", {
          operation: context?.operation,
          code: error.code,
          attempts: attempt + 1,
          error,
        });
        throw error;
      }

      logger.warn("Error temporal, reintentando", {
        operation: context?.operation,
        code: error.code,
        attempt: attempt + 1,
        delayMs: Math.round(delay),
      });
      await sleep(delay);
    }
  }
}
