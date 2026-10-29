import { Octokit } from "@octokit/rest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, ValidationError } from "../src/errors/index.js";
import { createGitHubClient, getGitHubClient, getToken, resetGitHubClient } from "../src/github/client.js";
import {
  addCommentToIssue,
  closeIssue,
  createBranch,
  createCommit,
  createIssue,
  createRepository,
  listIssues,
  listRepositories,
} from "../src/github/operations.js";

// Ningún test llama a GitHub de verdad: Octokit se reemplaza por un mock
vi.mock("@octokit/rest", () => ({ Octokit: vi.fn() }));

/** Octokit falso con solo los métodos que usan las operaciones. */
function fakeOctokit() {
  const rest = {
    users: { getAuthenticated: vi.fn().mockResolvedValue({ data: { login: "octocat" } }) },
    repos: {
      get: vi.fn(),
      createForAuthenticatedUser: vi.fn(),
      listForAuthenticatedUser: vi.fn(),
      getContent: vi.fn(),
      createOrUpdateFileContents: vi.fn(),
    },
    git: { getRef: vi.fn(), createRef: vi.fn() },
    issues: { create: vi.fn(), listForRepo: vi.fn(), update: vi.fn(), createComment: vi.fn() },
  };
  return { rest, octokit: { rest } as unknown as Octokit };
}

/** Simula un RequestError de Octokit. */
function httpError(status: number, message = `HttpError ${status}`, data?: unknown) {
  return Object.assign(new Error(message), { status, response: { headers: {}, data } });
}

const rawRepo = {
  name: "demo",
  full_name: "octocat/demo",
  description: "Repo de prueba",
  private: false,
  html_url: "https://github.com/octocat/demo",
  default_branch: "main",
  updated_at: "2026-10-28T00:00:00Z",
  id: 1,
  node_id: "x",
};

const rawIssue = (number: number, extra: object = {}) => ({
  number,
  title: `Issue ${number}`,
  state: "open",
  html_url: `https://github.com/octocat/demo/issues/${number}`,
  user: { login: "octocat" },
  labels: [{ name: "bug" }, "urgente"],
  comments: 2,
  created_at: "2026-10-28T00:00:00Z",
  ...extra,
});

beforeEach(() => {
  // Silencia los logs (stderr) durante los tests
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

describe("createRepository", () => {
  it("envía los parámetros a GitHub y devuelve un resumen compacto", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.createForAuthenticatedUser.mockResolvedValue({ data: rawRepo });

    const result = await createRepository(octokit, { name: "demo", description: "Repo de prueba", private: false, autoInit: true });

    expect(rest.repos.createForAuthenticatedUser).toHaveBeenCalledWith({
      name: "demo",
      description: "Repo de prueba",
      private: false,
      auto_init: true,
    });
    expect(result).toEqual({
      name: "demo",
      fullName: "octocat/demo",
      description: "Repo de prueba",
      private: false,
      url: "https://github.com/octocat/demo",
      defaultBranch: "main",
      updatedAt: "2026-10-28T00:00:00Z",
    });
  });

  it("traduce el 422 de nombre duplicado a lenguaje natural", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.createForAuthenticatedUser.mockRejectedValue(
      httpError(422, "Repository creation failed.", { errors: [{ message: "name already exists on this account" }] }),
    );

    await expect(createRepository(octokit, { name: "demo", private: false, autoInit: true })).rejects.toThrow(
      "Ya existe un repositorio llamado demo en tu cuenta. Elige otro nombre.",
    );
  });

  it("credenciales inválidas (401) -> AuthenticationError", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.createForAuthenticatedUser.mockRejectedValue(httpError(401, "Bad credentials"));

    await expect(createRepository(octokit, { name: "demo", private: false, autoInit: true })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });
});

describe("listRepositories", () => {
  it("traduce la paginación al formato de GitHub", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.listForAuthenticatedUser.mockResolvedValue({ data: [rawRepo] });

    const repos = await listRepositories(octokit, { visibility: "private", sort: "updated", perPage: 10, page: 2 });

    expect(rest.repos.listForAuthenticatedUser).toHaveBeenCalledWith({
      visibility: "private",
      sort: "updated",
      per_page: 10,
      page: 2,
    });
    expect(repos.map((r) => r.fullName)).toEqual(["octocat/demo"]);
  });
});

describe("createIssue", () => {
  it("usa el usuario autenticado si no se indica owner (y lo cachea)", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.issues.create.mockResolvedValue({ data: rawIssue(7) });

    const issue = await createIssue(octokit, { repo: "demo", title: "Issue 7" });
    await createIssue(octokit, { repo: "demo", title: "Otro" });

    expect(rest.issues.create).toHaveBeenCalledWith(expect.objectContaining({ owner: "octocat", repo: "demo" }));
    expect(rest.users.getAuthenticated).toHaveBeenCalledTimes(1);
    expect(issue).toMatchObject({ number: 7, labels: ["bug", "urgente"], author: "octocat" });
  });

  it("repositorio inexistente (404) -> mensaje con owner/repo", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.issues.create.mockRejectedValue(httpError(404, "Not Found"));

    await expect(createIssue(octokit, { owner: "octocat", repo: "nope", title: "x" })).rejects.toThrow(
      "El repositorio octocat/nope no fue encontrado. Verifica el nombre e intenta de nuevo.",
    );
  });
});

describe("listIssues", () => {
  it("excluye pull requests y une los labels con comas", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.issues.listForRepo.mockResolvedValue({
      data: [rawIssue(1), rawIssue(2, { pull_request: { url: "x" } }), rawIssue(3)],
    });

    const issues = await listIssues(octokit, { owner: "octocat", repo: "demo", state: "open", labels: ["bug", "ui"], perPage: 30, page: 1 });

    expect(rest.issues.listForRepo).toHaveBeenCalledWith(expect.objectContaining({ labels: "bug,ui", state: "open" }));
    expect(issues.map((i) => i.number)).toEqual([1, 3]);
  });
});

describe("createCommit", () => {
  const input = { owner: "octocat", repo: "demo", path: "docs/notas.md", content: "# Hola ñ", message: "docs: notas" };
  const commitResponse = {
    data: {
      commit: { sha: "abc123", html_url: "https://github.com/octocat/demo/commit/abc123" },
      content: { html_url: "https://github.com/octocat/demo/blob/main/docs/notas.md" },
    },
  };

  it("crea un archivo nuevo: sin sha y con el contenido en base64", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.getContent.mockRejectedValue(httpError(404));
    rest.repos.createOrUpdateFileContents.mockResolvedValue(commitResponse);

    const result = await createCommit(octokit, input);

    const params = rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    expect(params.sha).toBeUndefined();
    expect(Buffer.from(params.content, "base64").toString("utf8")).toBe("# Hola ñ");
    expect(result).toMatchObject({ action: "created", commitSha: "abc123" });
  });

  it("modifica un archivo existente enviando su sha actual", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.getContent.mockResolvedValue({ data: { type: "file", sha: "old-sha" } });
    rest.repos.createOrUpdateFileContents.mockResolvedValue(commitResponse);

    const result = await createCommit(octokit, { ...input, branch: "develop" });

    expect(rest.repos.getContent).toHaveBeenCalledWith(expect.objectContaining({ ref: "develop" }));
    expect(rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ sha: "old-sha", branch: "develop" }),
    );
    expect(result.action).toBe("updated");
  });

  it("rechaza una ruta que es una carpeta sin intentar el commit", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.getContent.mockResolvedValue({ data: [{ name: "a.md" }] });

    await expect(createCommit(octokit, { ...input, path: "docs" })).rejects.toBeInstanceOf(ValidationError);
    expect(rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it("branch inexistente -> mensaje que nombra la branch, no el repo", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.getContent.mockRejectedValue(httpError(404, "No commit found for the ref nope"));
    rest.repos.createOrUpdateFileContents.mockRejectedValue(httpError(404, "Branch nope not found"));

    await expect(createCommit(octokit, { ...input, branch: "nope" })).rejects.toThrow(
      "La branch nope no existe en el repositorio octocat/demo",
    );
  });
});

describe("createBranch (extra)", () => {
  it("sin fromBranch usa la branch por defecto y crea el ref con su SHA", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.repos.get.mockResolvedValue({ data: { default_branch: "main" } });
    rest.git.getRef.mockResolvedValue({ data: { object: { sha: "sha-main" } } });
    rest.git.createRef.mockResolvedValue({ data: {} });

    const branch = await createBranch(octokit, { owner: "octocat", repo: "demo", branch: "feature/login" });

    expect(rest.git.getRef).toHaveBeenCalledWith({ owner: "octocat", repo: "demo", ref: "heads/main" });
    expect(rest.git.createRef).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "demo",
      ref: "refs/heads/feature/login",
      sha: "sha-main",
    });
    expect(branch).toEqual({
      name: "feature/login",
      fromBranch: "main",
      sha: "sha-main",
      url: "https://github.com/octocat/demo/tree/feature/login",
    });
  });

  it("branch de origen inexistente -> mensaje que la nombra, sin intentar crear", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.git.getRef.mockRejectedValue(httpError(404, "Not Found"));

    await expect(
      createBranch(octokit, { owner: "octocat", repo: "demo", branch: "nueva", fromBranch: "nope" }),
    ).rejects.toThrow("La branch de origen nope no existe en el repositorio octocat/demo");
    expect(rest.repos.get).not.toHaveBeenCalled();
    expect(rest.git.createRef).not.toHaveBeenCalled();
  });

  it("branch que ya existe (422) -> mensaje claro, no el de repositorio duplicado", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.git.getRef.mockResolvedValue({ data: { object: { sha: "x" } } });
    rest.git.createRef.mockRejectedValue(httpError(422, "Reference already exists"));

    await expect(
      createBranch(octokit, { owner: "octocat", repo: "demo", branch: "develop", fromBranch: "main" }),
    ).rejects.toThrow("La branch develop ya existe en el repositorio octocat/demo. Elige otro nombre.");
  });
});

describe("closeIssue y addCommentToIssue (extra)", () => {
  it("closeIssue envía state=closed con el motivo", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.issues.update.mockResolvedValue({ data: rawIssue(5, { state: "closed" }) });

    const issue = await closeIssue(octokit, { owner: "octocat", repo: "demo", issueNumber: 5, reason: "not_planned" });

    expect(rest.issues.update).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "demo",
      issue_number: 5,
      state: "closed",
      state_reason: "not_planned",
    });
    expect(issue).toMatchObject({ number: 5, state: "closed" });
  });

  it("issue inexistente (404) -> mensaje con el número del issue", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.issues.update.mockRejectedValue(httpError(404, "Not Found"));

    await expect(
      closeIssue(octokit, { owner: "octocat", repo: "demo", issueNumber: 99, reason: "completed" }),
    ).rejects.toThrow("El issue #99 no existe en el repositorio octocat/demo");
  });

  it("addCommentToIssue devuelve el id y la URL del comentario", async () => {
    const { rest, octokit } = fakeOctokit();
    rest.issues.createComment.mockResolvedValue({
      data: { id: 321, html_url: "https://github.com/octocat/demo/issues/5#issuecomment-321" },
    });

    const comment = await addCommentToIssue(octokit, { repo: "demo", issueNumber: 5, body: "Avance listo" });

    expect(rest.issues.createComment).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "demo",
      issue_number: 5,
      body: "Avance listo",
    });
    expect(comment).toEqual({
      id: 321,
      issueNumber: 5,
      url: "https://github.com/octocat/demo/issues/5#issuecomment-321",
    });
  });
});

describe("client", () => {
  beforeEach(() => {
    resetGitHubClient();
    vi.mocked(Octokit).mockClear();
  });

  it("getToken lanza AuthenticationError con instrucciones si falta GITHUB_TOKEN", () => {
    expect(() => getToken({})).toThrow(AuthenticationError);
    expect(() => getToken({ GITHUB_TOKEN: "   " })).toThrow(/settings\/tokens/);
    expect(getToken({ GITHUB_TOKEN: " abc " })).toBe("abc");
  });

  it("createGitHubClient configura Octokit con el token", () => {
    createGitHubClient("token-de-prueba");
    expect(Octokit).toHaveBeenCalledWith(expect.objectContaining({ auth: "token-de-prueba" }));
  });

  it("getGitHubClient reutiliza la misma instancia (singleton)", () => {
    vi.stubEnv("GITHUB_TOKEN", "token-de-prueba");
    expect(getGitHubClient()).toBe(getGitHubClient());
    expect(Octokit).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
});
