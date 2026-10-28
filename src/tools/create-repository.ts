import { createRepository } from "../github/operations.js";
import { createRepositorySchema } from "../schemas/index.js";
import { defineTool, formatResult } from "./types.js";

export const createRepositoryTool = defineTool({
  name: "create_repository",
  title: "Crear repositorio",
  description:
    "Crea un nuevo repositorio de GitHub en la cuenta del usuario autenticado. " +
    "Úsala cuando el usuario pida crear o iniciar un proyecto/repositorio. " +
    "Por defecto es público y se inicializa con un README. Devuelve el nombre completo y la URL.",
  inputSchema: createRepositorySchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async execute(octokit, input) {
    const repo = await createRepository(octokit, input);
    const visibility = repo.private ? "privado" : "público";
    return formatResult(`Repositorio ${visibility} ${repo.fullName} creado: ${repo.url}`, repo);
  },
});
