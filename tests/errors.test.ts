import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AuthenticationError,
  GitHubAPIError,
  NetworkError,
  ValidationError,
  formatErrorForLLM,
  fromZodError,
  toAppError,
} from "../src/errors/index.js";

/** Simula un RequestError de Octokit. */
function httpError(status: number, extra: { headers?: Record<string, string>; data?: unknown; message?: string } = {}) {
  return Object.assign(new Error(extra.message ?? `HttpError ${status}`), {
    status,
    response: { headers: extra.headers ?? {}, data: extra.data },
  });
}

describe("toAppError: transformación de errores a lenguaje natural", () => {
  it("404 -> GitHubAPIError con el nombre del repositorio", () => {
    const error = toAppError(httpError(404), { owner: "octocat", repo: "mi-repo" });
    expect(error).toBeInstanceOf(GitHubAPIError);
    expect(error.message).toBe(
      "El repositorio octocat/mi-repo no fue encontrado. Verifica el nombre e intenta de nuevo.",
    );
    expect(error.retryable).toBe(false);
  });

  it("401 -> AuthenticationError (credenciales inválidas)", () => {
    const error = toAppError(httpError(401));
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.message).toMatch(/GITHUB_TOKEN/);
  });

  it("403 con x-ratelimit-remaining=0 -> rate limit reintentable", () => {
    const reset = String(Math.floor(Date.now() / 1000) + 30);
    const error = toAppError(
      httpError(403, { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset } }),
    ) as GitHubAPIError;
    expect(error.rateLimited).toBe(true);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBeGreaterThan(0);
  });

  it("403 sin rate limit -> falta de permisos (no reintentable)", () => {
    const error = toAppError(httpError(403), { repo: "privado" }) as GitHubAPIError;
    expect(error.rateLimited).toBe(false);
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/permisos/);
  });

  it("422 'already exists' -> mensaje de repositorio duplicado", () => {
    const error = toAppError(
      httpError(422, { data: { errors: [{ message: "name already exists on this account" }] } }),
      { repo: "demo" },
    );
    expect(error.message).toBe("Ya existe un repositorio llamado demo en tu cuenta. Elige otro nombre.");
  });

  it("500 -> error temporal reintentable", () => {
    const error = toAppError(httpError(502));
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/problemas temporales/);
  });

  it("error de red (ENOTFOUND) -> NetworkError", () => {
    const error = toAppError(Object.assign(new Error("getaddrinfo ENOTFOUND api.github.com"), { code: "ENOTFOUND" }));
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.retryable).toBe(true);
  });

  it("formatErrorForLLM incluye el código y el mensaje", () => {
    expect(formatErrorForLLM(httpError(404), { repo: "x" })).toBe(
      "Error (GITHUB_API_ERROR): El repositorio x no fue encontrado. Verifica el nombre e intenta de nuevo.",
    );
  });
});

describe("fromZodError", () => {
  it("convierte los issues de Zod en un ValidationError legible", () => {
    const schema = z.object({ name: z.string().min(3, "Debe tener al menos 3 caracteres") });
    const result = schema.safeParse({ name: "a" });
    expect(result.success).toBe(false);
    if (result.success) return;

    const error = fromZodError(result.error);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.issues).toEqual(["name: Debe tener al menos 3 caracteres"]);
    expect(error.message).toContain("name: Debe tener al menos 3 caracteres");
  });
});
