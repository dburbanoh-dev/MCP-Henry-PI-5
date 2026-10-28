import { listRepositories } from "../github/operations.js";
import { listRepositoriesSchema } from "../schemas/index.js";
import { defineTool, formatResult } from "./types.js";

export const listRepositoriesTool = defineTool({
  name: "list_repositories",
  title: "Listar repositorios",
  description:
    "Lista los repositorios del usuario autenticado (propios, de colaboración y de sus organizaciones), " +
    "ordenados por actualización reciente. Úsala para ver qué repos existen o para encontrar el nombre " +
    "exacto de un repositorio antes de usar otra tool. Soporta filtro por visibilidad y paginación.",
  inputSchema: listRepositoriesSchema,
  annotations: { readOnlyHint: true, openWorldHint: true },
  async execute(octokit, input) {
    const repos = await listRepositories(octokit, input);
    if (repos.length === 0) {
      return input.page > 1
        ? `No hay más repositorios en la página ${input.page}.`
        : "No se encontraron repositorios con esos filtros.";
    }
    return formatResult(`Se encontraron ${repos.length} repositorios (página ${input.page}).`, repos);
  },
});
