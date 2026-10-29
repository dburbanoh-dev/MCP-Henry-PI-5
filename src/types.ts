/**
 * Tipos compartidos.
 *
 * Las respuestas de GitHub traen decenas de campos (URLs de API, ids, nodos...).
 * Devolverlas completas al LLM gasta tokens y lo confunde, así que cada
 * operación las reduce a estos resúmenes con solo lo útil para el usuario.
 */

export interface RepositorySummary {
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  url: string;
  defaultBranch: string;
  updatedAt: string | null;
}

export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string | null;
  labels: string[];
  comments: number;
  createdAt: string;
}

export interface BranchResult {
  name: string;
  fromBranch: string;
  /** SHA del commit desde el que nace la branch. */
  sha: string;
  url: string;
}

export interface CommentResult {
  id: number;
  issueNumber: number;
  url: string;
}

export interface CommitResult {
  /** "created" si el archivo es nuevo, "updated" si se modificó uno existente. */
  action: "created" | "updated";
  path: string;
  branch: string | null;
  commitSha: string;
  commitUrl: string;
  fileUrl: string | null;
}
