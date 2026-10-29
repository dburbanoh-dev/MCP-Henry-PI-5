import { addCommentToIssue } from "../github/operations.js";
import { addCommentToIssueSchema } from "../schemas/index.js";
import { defineTool, formatResult } from "./types.js";

export const addCommentToIssueTool = defineTool({
  name: "add_comment_to_issue",
  title: "Comentar en un issue",
  description:
    "Agrega un comentario en Markdown a un issue existente, identificado por su número. " +
    "Úsala para dejar avances, preguntas o notas de seguimiento en un issue. " +
    "Si no se conoce el número, usa primero list_issues. Devuelve la URL del comentario.",
  inputSchema: addCommentToIssueSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async execute(octokit, input) {
    const comment = await addCommentToIssue(octokit, input);
    return formatResult(`Comentario agregado al issue #${comment.issueNumber}: ${comment.url}`, comment);
  },
});
