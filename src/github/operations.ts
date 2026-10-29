import type { Octokit } from "@octokit/rest";
import { GitHubAPIError, ValidationError, type ErrorContext } from "../errors/index.js";
import type {
  AddCommentToIssueInput,
  CloseIssueInput,
  CreateBranchInput,
  CreateCommitInput,
  CreateIssueInput,
  CreateRepositoryInput,
  ListIssuesInput,
  ListRepositoriesInput,
} from "../schemas/index.js";
import type { BranchResult, CommentResult, CommitResult, IssueSummary, RepositorySummary } from "../types.js";
import { logger } from "../utils/logging.js";
import { withRetry } from "../utils/retry.js";

/**
 * Operaciones contra la API de GitHub.
 *
 * - Reciben el cliente de Octokit como parámetro (inyección de dependencias):
 *   en los tests se pasa un Octokit falso y no se hace ninguna llamada real.
 * - Reciben inputs ya validados por Zod (los tipos salen de los schemas).
 * - Toda llamada pasa por withRetry, que reintenta errores temporales y
 *   convierte cualquier fallo en un AppError con mensaje en español.
 * - Devuelven resúmenes compactos (ver types.ts), no la respuesta cruda.
 */

/* ------------------------------------------------------------------ */
/* Usuario autenticado                                                 */
/* ------------------------------------------------------------------ */

// Cache del login por cliente: el usuario no cambia durante la sesión
const loginCache = new WeakMap<Octokit, Promise<string>>();

/** Devuelve el login del dueño del token (ej: "octocat"). */
export function getAuthenticatedLogin(octokit: Octokit): Promise<string> {
  let login = loginCache.get(octokit);
  if (!login) {
    login = withRetry(async () => (await octokit.rest.users.getAuthenticated()).data.login, {
      context: { operation: "get_authenticated_user" },
    });
    // Si falla, no se guarda en cache para poder reintentar en la próxima llamada
    login.catch(() => loginCache.delete(octokit));
    loginCache.set(octokit, login);
  }
  return login;
}

/** Si el LLM no indicó owner, se usa el usuario autenticado. */
async function resolveOwner(octokit: Octokit, owner?: string): Promise<string> {
  return owner ?? getAuthenticatedLogin(octokit);
}

/* ------------------------------------------------------------------ */
/* Repositorios                                                        */
/* ------------------------------------------------------------------ */

interface RawRepo {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch?: string;
  updated_at?: string | null;
}

function toRepositorySummary(repo: RawRepo): RepositorySummary {
  return {
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    private: repo.private,
    url: repo.html_url,
    defaultBranch: repo.default_branch ?? "main",
    updatedAt: repo.updated_at ?? null,
  };
}

export async function createRepository(
  octokit: Octokit,
  input: CreateRepositoryInput,
): Promise<RepositorySummary> {
  const context: ErrorContext = { repo: input.name, operation: "create_repository" };
  const { data } = await withRetry(
    () =>
      octokit.rest.repos.createForAuthenticatedUser({
        name: input.name,
        description: input.description,
        private: input.private,
        auto_init: input.autoInit,
      }),
    { context },
  );
  logger.info("Repositorio creado", { repo: data.full_name });
  return toRepositorySummary(data);
}

export async function listRepositories(
  octokit: Octokit,
  input: ListRepositoriesInput,
): Promise<RepositorySummary[]> {
  const { data } = await withRetry(
    () =>
      octokit.rest.repos.listForAuthenticatedUser({
        visibility: input.visibility,
        sort: input.sort,
        per_page: input.perPage,
        page: input.page,
      }),
    { context: { operation: "list_repositories" } },
  );
  return data.map(toRepositorySummary);
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

interface RawIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string } | null;
  labels: Array<string | { name?: string }>;
  comments: number;
  created_at: string;
  pull_request?: unknown;
}

function toIssueSummary(issue: RawIssue): IssueSummary {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
    author: issue.user?.login ?? null,
    labels: issue.labels
      .map((label) => (typeof label === "string" ? label : label.name))
      .filter((name): name is string => Boolean(name)),
    comments: issue.comments,
    createdAt: issue.created_at,
  };
}

export async function createIssue(octokit: Octokit, input: CreateIssueInput): Promise<IssueSummary> {
  const owner = await resolveOwner(octokit, input.owner);
  const context: ErrorContext = { owner, repo: input.repo, operation: "create_issue" };
  const { data } = await withRetry(
    () =>
      octokit.rest.issues.create({
        owner,
        repo: input.repo,
        title: input.title,
        body: input.body,
        labels: input.labels,
      }),
    { context },
  );
  logger.info("Issue creado", { repo: `${owner}/${input.repo}`, number: data.number });
  return toIssueSummary(data);
}

export async function listIssues(octokit: Octokit, input: ListIssuesInput): Promise<IssueSummary[]> {
  const owner = await resolveOwner(octokit, input.owner);
  const context: ErrorContext = { owner, repo: input.repo, operation: "list_issues" };
  const { data } = await withRetry(
    () =>
      octokit.rest.issues.listForRepo({
        owner,
        repo: input.repo,
        state: input.state,
        labels: input.labels?.join(","),
        per_page: input.perPage,
        page: input.page,
      }),
    { context },
  );
  // La API de issues de GitHub también devuelve pull requests: se excluyen
  return data.filter((issue) => !issue.pull_request).map(toIssueSummary);
}

/* ------------------------------------------------------------------ */
/* Commits                                                             */
/* ------------------------------------------------------------------ */

/**
 * Busca el SHA actual del archivo. GitHub lo exige para modificar un archivo
 * existente (evita pisar cambios ajenos). Devuelve undefined si no existe.
 */
async function getExistingFileSha(
  octokit: Octokit,
  params: { owner: string; repo: string; path: string; branch?: string },
  context: ErrorContext,
): Promise<string | undefined> {
  const data = await withRetry(
    async () => {
      try {
        const response = await octokit.rest.repos.getContent({
          owner: params.owner,
          repo: params.repo,
          path: params.path,
          ref: params.branch,
        });
        return response.data;
      } catch (error) {
        // 404 aquí es normal: el archivo todavía no existe y se va a crear
        if ((error as { status?: number }).status === 404) return undefined;
        throw error;
      }
    },
    { context },
  );

  if (data === undefined) return undefined;
  if (Array.isArray(data)) {
    throw new ValidationError(`La ruta ${params.path} es una carpeta. Indica la ruta de un archivo, por ejemplo ${params.path}/README.md`);
  }
  if (data.type !== "file") {
    throw new ValidationError(`La ruta ${params.path} no es un archivo de texto (es de tipo ${data.type}).`);
  }
  return data.sha;
}

/** Crea o modifica un archivo en el repositorio, generando un commit. */
export async function createCommit(octokit: Octokit, input: CreateCommitInput): Promise<CommitResult> {
  const owner = await resolveOwner(octokit, input.owner);
  const context: ErrorContext = {
    owner,
    repo: input.repo,
    branch: input.branch,
    operation: "create_commit",
  };

  const sha = await getExistingFileSha(
    octokit,
    { owner, repo: input.repo, path: input.path, branch: input.branch },
    context,
  );

  const { data } = await withRetry(
    () =>
      octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo: input.repo,
        path: input.path,
        message: input.message,
        // La API de contenidos de GitHub exige el archivo en base64
        content: Buffer.from(input.content, "utf8").toString("base64"),
        sha,
        branch: input.branch,
      }),
    { context },
  );

  const result: CommitResult = {
    action: sha ? "updated" : "created",
    path: input.path,
    branch: input.branch ?? null,
    commitSha: data.commit.sha ?? "",
    commitUrl: data.commit.html_url ?? "",
    fileUrl: data.content?.html_url ?? null,
  };
  logger.info("Commit creado", { repo: `${owner}/${input.repo}`, path: input.path, action: result.action });
  return result;
}

/* ------------------------------------------------------------------ */
/* Tools extra: branches y gestión de issues                           */
/* ------------------------------------------------------------------ */

/** Crea una branch nueva apuntando al último commit de otra (por defecto, la principal). */
export async function createBranch(octokit: Octokit, input: CreateBranchInput): Promise<BranchResult> {
  const owner = await resolveOwner(octokit, input.owner);
  const context: ErrorContext = { owner, repo: input.repo, operation: "create_branch" };

  // Si no se indicó branch de origen, se usa la principal del repo (main, master...)
  const fromBranch =
    input.fromBranch ??
    (await withRetry(async () => (await octokit.rest.repos.get({ owner, repo: input.repo })).data.default_branch, {
      context,
    }));

  // Una branch en git es solo un puntero a un commit: primero se busca el SHA del origen
  const sha = await withRetry(
    async () => {
      try {
        const { data } = await octokit.rest.git.getRef({ owner, repo: input.repo, ref: `heads/${fromBranch}` });
        return data.object.sha;
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          throw new GitHubAPIError(
            `La branch de origen ${fromBranch} no existe en el repositorio ${owner}/${input.repo} ` +
              "(o el repositorio no existe). Verifica el nombre u omite fromBranch para usar la branch por defecto.",
            404,
            { cause: error },
          );
        }
        throw error;
      }
    },
    { context: { ...context, branch: fromBranch } },
  );

  await withRetry(
    () => octokit.rest.git.createRef({ owner, repo: input.repo, ref: `refs/heads/${input.branch}`, sha }),
    { context: { ...context, branch: input.branch } },
  );

  logger.info("Branch creada", { repo: `${owner}/${input.repo}`, branch: input.branch, fromBranch });
  return {
    name: input.branch,
    fromBranch,
    sha,
    url: `https://github.com/${owner}/${input.repo}/tree/${input.branch}`,
  };
}

/** Cierra un issue indicando el motivo (resuelto o no planificado). */
export async function closeIssue(octokit: Octokit, input: CloseIssueInput): Promise<IssueSummary> {
  const owner = await resolveOwner(octokit, input.owner);
  const context: ErrorContext = { owner, repo: input.repo, issueNumber: input.issueNumber, operation: "close_issue" };
  const { data } = await withRetry(
    () =>
      octokit.rest.issues.update({
        owner,
        repo: input.repo,
        issue_number: input.issueNumber,
        state: "closed",
        state_reason: input.reason,
      }),
    { context },
  );
  logger.info("Issue cerrado", { repo: `${owner}/${input.repo}`, number: data.number, reason: input.reason });
  return toIssueSummary(data);
}

/** Agrega un comentario a un issue existente. */
export async function addCommentToIssue(octokit: Octokit, input: AddCommentToIssueInput): Promise<CommentResult> {
  const owner = await resolveOwner(octokit, input.owner);
  const context: ErrorContext = {
    owner,
    repo: input.repo,
    issueNumber: input.issueNumber,
    operation: "add_comment_to_issue",
  };
  const { data } = await withRetry(
    () =>
      octokit.rest.issues.createComment({
        owner,
        repo: input.repo,
        issue_number: input.issueNumber,
        body: input.body,
      }),
    { context },
  );
  logger.info("Comentario agregado", { repo: `${owner}/${input.repo}`, issue: input.issueNumber });
  return { id: data.id, issueNumber: input.issueNumber, url: data.html_url };
}
