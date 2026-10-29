import { createBranch } from "../github/operations.js";
import { createBranchSchema } from "../schemas/index.js";
import { defineTool, formatResult } from "./types.js";

export const createBranchTool = defineTool({
  name: "create_branch",
  title: "Crear branch",
  description:
    "Crea una branch nueva en un repositorio de GitHub a partir del último commit de otra branch " +
    "(por defecto, la branch principal del repo). Úsala antes de trabajar en una funcionalidad o un fix " +
    "por separado; luego create_commit puede escribir en ella. Si no se indica owner, se usa el usuario autenticado.",
  inputSchema: createBranchSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async execute(octokit, input) {
    const branch = await createBranch(octokit, input);
    return formatResult(`Branch ${branch.name} creada desde ${branch.fromBranch}: ${branch.url}`, branch);
  },
});
