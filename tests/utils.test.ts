import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubAPIError, NetworkError } from "../src/errors/index.js";
import { logger, sanitize } from "../src/utils/logging.js";
import { computeDelay, withRetry } from "../src/utils/retry.js";

// Silencia los logs durante los tests y permite inspeccionarlos
function captureStderr() {
  return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

const noSleep = vi.fn(async () => {});

describe("withRetry", () => {
  afterEach(() => noSleep.mockClear());

  it("reintenta errores temporales y luego tiene éxito", async () => {
    captureStderr();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 503 }))
      .mockResolvedValueOnce("ok");

    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  it("no reintenta un 404 (no es temporal)", async () => {
    captureStderr();
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));

    await expect(withRetry(fn, { sleep: noSleep, context: { repo: "nope" } })).rejects.toThrow(
      "El repositorio nope no fue encontrado",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("se rinde después de agotar los reintentos", async () => {
    captureStderr();
    const fn = vi.fn().mockRejectedValue(new NetworkError("sin red"));

    await expect(withRetry(fn, { retries: 2, sleep: noSleep })).rejects.toBeInstanceOf(NetworkError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("no espera si el rate limit pide más que maxDelayMs", async () => {
    captureStderr();
    const fn = vi.fn().mockRejectedValue(
      new GitHubAPIError("rate limit", 403, { rateLimited: true, retryAfterMs: 60 * 60 * 1000 }),
    );

    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow("rate limit");
    expect(noSleep).not.toHaveBeenCalled();
  });
});

describe("computeDelay (exponential backoff)", () => {
  const error = new NetworkError("x");
  const opts = { baseDelayMs: 100, maxDelayMs: 1000, random: () => 0 };

  it("duplica la espera en cada intento y respeta el tope", () => {
    expect([0, 1, 2, 3, 4].map((a) => computeDelay(a, error, opts))).toEqual([100, 200, 400, 800, 1000]);
  });
});

describe("logger", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("oculta tokens y campos sensibles", () => {
    const token = "ghp_" + "a".repeat(36);
    expect(sanitize({ token, headers: { authorization: `token ${token}` }, note: `uso ${token}` })).toEqual({
      token: "[REDACTED]",
      headers: { authorization: "[REDACTED]" },
      note: "uso [REDACTED]",
    });
  });

  it("escribe en stderr (nunca en stdout) y respeta LOG_LEVEL", () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    const stderr = captureStderr();
    const stdout = vi.spyOn(process.stdout, "write");

    logger.info("no se muestra");
    logger.warn("sí se muestra");

    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0][0])).toContain("sí se muestra");
    expect(stdout).not.toHaveBeenCalled();
  });
});
