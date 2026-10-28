/**
 * Logger del MCP server.
 *
 * Reglas importantes:
 * 1. Escribe SIEMPRE en stderr. stdout es el canal JSON-RPC del protocolo MCP
 *    y cualquier texto extra ahí rompe la comunicación con Antigravity.
 * 2. Nunca expone secretos: los tokens y campos sensibles se reemplazan
 *    por "[REDACTED]" antes de escribir.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Claves cuyo valor nunca se debe mostrar. */
const SENSITIVE_KEYS = /token|authorization|password|secret|api[-_]?key|cookie/i;

/** Formatos de tokens de GitHub (classic, OAuth, fine-grained, etc.). */
const TOKEN_PATTERNS = [/gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g, /Bearer\s+[A-Za-z0-9._-]+/gi];

const REDACTED = "[REDACTED]";

/** Reemplaza tokens que aparezcan dentro de un texto. */
export function redactString(text: string): string {
  return TOKEN_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, REDACTED), text);
}

/** Copia profunda de `value` con todos los datos sensibles ocultos. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[...]";
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        SENSITIVE_KEYS.test(key) ? REDACTED : sanitize(val, depth + 1),
      ]),
    );
  }
  return value;
}

function currentLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  return level && level in LEVELS ? (level as LogLevel) : "info";
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel()]) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    message: redactString(message),
    ...(meta ? { meta: sanitize(meta) } : {}),
  };
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};
