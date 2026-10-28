import { listIssues } from "../github/operations.js";
import { listIssuesSchema } from "../schemas/index.js";
import { defineTool, formatResult } from "./types.js";

const STATE_LABEL = { open: "issues abiertos", closed: "issues cerrados", all: "issues" } as const;

export const listIssuesTool = defineTool({
  name: "list_issues",
  title: "Listar issues",
  description:
    "Lista los issues de un repositorio de GitHub (por defecto solo los abiertos), sin incluir pull requests. " +
    "Úsala para revisar pendientes, bugs reportados o buscar un issue por label. " +
    "Si no se indica owner, se usa el usuario autenticado.",
  inputSchema: listIssuesSchema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  async execute(octokit, input) {
    const issues = await listIssues(octokit, input);
    const state = STATE_LABEL[input.state];
    const repo = input.owner ? `${input.owner}/${input.repo}` : input.repo;
    if (issues.length === 0) {
      const labels = input.labels?.length ? ` con labels ${input.labels.join(", ")}` : "";
      return `No hay ${state} en ${repo}${labels}.`;
    }
    return formatResult(`Se encontraron ${issues.length} ${state} en ${repo}.`, issues);
  },
});
