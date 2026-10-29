import { closeIssue } from "../github/operations.js";
import { closeIssueSchema } from "../schemas/index.js";
import { defineTool, formatResult } from "./types.js";

const REASON_LABEL = { completed: "resuelto", not_planned: "no planificado" } as const;

export const closeIssueTool = defineTool({
  name: "close_issue",
  title: "Cerrar issue",
  description:
    "Cierra un issue de un repositorio de GitHub por su número, indicando si quedó resuelto (completed) " +
    "o si no se hará (not_planned). Úsala cuando el usuario diga que un issue está terminado o descartado. " +
    "Si no se conoce el número, usa primero list_issues.",
  inputSchema: closeIssueSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async execute(octokit, input) {
    const issue = await closeIssue(octokit, input);
    return formatResult(`Issue #${issue.number} "${issue.title}" cerrado como ${REASON_LABEL[input.reason]}.`, issue);
  },
});
