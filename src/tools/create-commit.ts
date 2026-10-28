import { createCommit } from "../github/operations.js";
import { createCommitSchema } from "../schemas/index.js";
import { defineTool, formatResult } from "./types.js";

export const createCommitTool = defineTool({
  name: "create_commit",
  title: "Crear commit",
  description:
    "Hace un commit que crea o reemplaza UN archivo de texto en un repositorio de GitHub. " +
    "El contenido enviado reemplaza el archivo completo (no es un parche). " +
    "Si no se indica branch, se usa la branch por defecto del repo; si no se indica owner, el usuario autenticado. " +
    "Devuelve si el archivo fue creado o actualizado, y el SHA y URL del commit.",
  inputSchema: createCommitSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async execute(octokit, input) {
    const commit = await createCommit(octokit, input);
    const verb = commit.action === "created" ? "creado" : "actualizado";
    const where = commit.branch ? ` en la branch ${commit.branch}` : "";
    return formatResult(`Archivo ${commit.path} ${verb}${where}. Commit: ${commit.commitUrl}`, commit);
  },
});
