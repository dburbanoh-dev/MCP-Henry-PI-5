import { createIssue } from "../github/operations.js";
import { createIssueSchema } from "../schemas/index.js";
import { defineTool, formatResult } from "./types.js";

export const createIssueTool = defineTool({
  name: "create_issue",
  title: "Crear issue",
  description:
    "Abre un issue nuevo en un repositorio de GitHub con título, descripción en Markdown y labels opcionales. " +
    "Úsala para reportar bugs, registrar tareas o pedidos de mejora. " +
    "Si no se indica owner, se usa el usuario autenticado. Devuelve el número y la URL del issue.",
  inputSchema: createIssueSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async execute(octokit, input) {
    const issue = await createIssue(octokit, input);
    return formatResult(`Issue #${issue.number} "${issue.title}" creado: ${issue.url}`, issue);
  },
});
