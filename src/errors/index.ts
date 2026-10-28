import type { ZodError } from "zod";

/**
 * Errores propios del MCP server.
 *
 * Idea clave: el LLM no entiende un stack trace ni un "HttpError 404".
 * Cada error lleva un `message` en lenguaje natural que el agente puede
 * repetirle al usuario y que le sugiere qué hacer a continuación.
 */

/** Contexto opcional para que los mensajes nombren el recurso afectado. */
export interface ErrorContext {
  owner?: string;
  repo?: string;
  /** Nombre de la operación, por ejemplo "create_issue". */
  operation?: string;
}

/** Clase base: todos los errores del server heredan de aquí. */
export abstract class AppError extends Error {
  abstract readonly code: string;
  /** true si vale la pena reintentar la operación. */
  readonly retryable: boolean = false;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Los parámetros que mandó el LLM no cumplen el schema de Zod. */
export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";

  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

/** Token ausente, inválido o expirado (HTTP 401). */
export class AuthenticationError extends AppError {
  readonly code = "AUTHENTICATION_ERROR";
}

/** GitHub respondió con un error HTTP (403, 404, 409, 422, 5xx...). */
export class GitHubAPIError extends AppError {
  readonly code = "GITHUB_API_ERROR";
  override readonly retryable: boolean;
  readonly rateLimited: boolean;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    readonly status: number,
    options: {
      cause?: unknown;
      /** true si es un error de rate limiting. */
      rateLimited?: boolean;
      /** Milisegundos que GitHub pide esperar antes de reintentar. */
      retryAfterMs?: number;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.rateLimited = options.rateLimited ?? false;
    this.retryAfterMs = options.retryAfterMs;
    // Se reintenta solo lo que es temporal: rate limit y errores 5xx de GitHub
    this.retryable = this.rateLimited || status >= 500;
  }
}

/** No se pudo llegar a GitHub (sin internet, DNS, timeout...). */
export class NetworkError extends AppError {
  readonly code = "NETWORK_ERROR";
  override readonly retryable = true;
}

/* ------------------------------------------------------------------ */
/* Transformaciones                                                    */
/* ------------------------------------------------------------------ */

/** Convierte un ZodError en un ValidationError legible. */
export function fromZodError(error: ZodError): ValidationError {
  const issues = error.issues.map((issue) => {
    const field = issue.path.map(String).join(".") || "input";
    return `${field}: ${issue.message}`;
  });
  return new ValidationError(
    `Los parámetros no son válidos. ${issues.join(" | ")}`,
    issues,
  );
}

/** Forma mínima de un error HTTP de Octokit (RequestError). */
interface HttpLikeError {
  status: number;
  message?: string;
  response?: {
    headers?: Record<string, string | number | undefined>;
    data?: unknown;
  };
}

function isHttpLikeError(error: unknown): error is HttpLikeError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

/** Códigos de Node que indican problemas de red. */
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function isNetworkLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code =
    (error as { code?: string }).code ??
    (error.cause as { code?: string } | undefined)?.code;
  if (code && NETWORK_CODES.has(code)) return true;
  // fetch (usado por Octokit) lanza TypeError("fetch failed") si no hay red
  return error.name === "TypeError" && /fetch failed/i.test(error.message);
}

function describeRepo(context: ErrorContext): string {
  if (context.owner && context.repo) return `${context.owner}/${context.repo}`;
  return context.repo ?? "solicitado";
}

/** Lee del body de GitHub el detalle de un error 422. */
function githubDetails(error: HttpLikeError): string {
  const data = error.response?.data as
    | { message?: string; errors?: Array<{ message?: string; code?: string; field?: string }> }
    | undefined;
  const details = data?.errors
    ?.map((e) => e.message ?? [e.field, e.code].filter(Boolean).join(" "))
    .filter(Boolean);
  return details?.length ? details.join("; ") : (data?.message ?? error.message ?? "");
}

function rateLimitInfo(error: HttpLikeError): { limited: boolean; retryAfterMs?: number } {
  const headers = error.response?.headers ?? {};
  const retryAfter = headers["retry-after"];
  const remaining = headers["x-ratelimit-remaining"];
  const reset = headers["x-ratelimit-reset"];

  if (retryAfter !== undefined) {
    return { limited: true, retryAfterMs: Number(retryAfter) * 1000 };
  }
  if (String(remaining) === "0") {
    const resetMs = Number(reset) * 1000 - Date.now();
    return { limited: true, retryAfterMs: Number.isFinite(resetMs) ? Math.max(resetMs, 0) : undefined };
  }
  if (error.status === 429 || /rate limit/i.test(error.message ?? "")) {
    return { limited: true };
  }
  return { limited: false };
}

/**
 * Convierte cualquier error (Octokit, red, Zod ya transformado...) en un
 * AppError con un mensaje en español que el LLM puede comunicar.
 */
export function toAppError(error: unknown, context: ErrorContext = {}): AppError {
  if (error instanceof AppError) return error;

  if (isHttpLikeError(error)) {
    const repo = describeRepo(context);

    switch (error.status) {
      case 401:
        return new AuthenticationError(
          "El token de GitHub es inválido o expiró. Revisa la variable GITHUB_TOKEN y vuelve a intentarlo.",
          { cause: error },
        );

      case 403:
      case 429: {
        const { limited, retryAfterMs } = rateLimitInfo(error);
        if (limited) {
          const wait = retryAfterMs ? ` Intenta de nuevo en ${Math.ceil(retryAfterMs / 1000)} segundos.` : "";
          return new GitHubAPIError(
            `Se alcanzó el límite de solicitudes de GitHub (rate limit).${wait}`,
            error.status,
            { cause: error, rateLimited: true, retryAfterMs },
          );
        }
        return new GitHubAPIError(
          `No tienes permisos para realizar esta operación en el repositorio ${repo}. ` +
            "Verifica que el token tenga los scopes repo, user y admin:org.",
          error.status,
          { cause: error },
        );
      }

      case 404:
        return new GitHubAPIError(
          `El repositorio ${repo} no fue encontrado. Verifica el nombre e intenta de nuevo.`,
          404,
          { cause: error },
        );

      case 409:
        return new GitHubAPIError(
          `Hubo un conflicto con el estado actual del repositorio ${repo} ` +
            "(por ejemplo, el repositorio está vacío o el archivo cambió). Revisa y vuelve a intentarlo.",
          409,
          { cause: error },
        );

      case 422: {
        const details = githubDetails(error);
        if (/already exists/i.test(details)) {
          return new GitHubAPIError(
            `Ya existe un repositorio llamado ${context.repo ?? "así"} en tu cuenta. Elige otro nombre.`,
            422,
            { cause: error },
          );
        }
        return new GitHubAPIError(
          `GitHub rechazó los datos enviados: ${details}`,
          422,
          { cause: error },
        );
      }

      default:
        if (error.status >= 500) {
          return new GitHubAPIError(
            "GitHub tiene problemas temporales. Intenta de nuevo en unos momentos.",
            error.status,
            { cause: error },
          );
        }
        return new GitHubAPIError(
          `GitHub respondió con un error (${error.status}): ${error.message ?? "sin detalle"}`,
          error.status,
          { cause: error },
        );
    }
  }

  if (isNetworkLikeError(error)) {
    return new NetworkError(
      "No se pudo conectar con GitHub. Revisa tu conexión a internet e intenta de nuevo.",
      { cause: error },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new GitHubAPIError(`Ocurrió un error inesperado: ${message}`, 0, { cause: error });
}

/** Texto final que el tool le devuelve al LLM cuando algo falla. */
export function formatErrorForLLM(error: unknown, context: ErrorContext = {}): string {
  const appError = toAppError(error, context);
  return `Error (${appError.code}): ${appError.message}`;
}
