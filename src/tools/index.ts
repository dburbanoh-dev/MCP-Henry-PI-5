import type { Octokit } from "@octokit/rest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatErrorForLLM } from "../errors/index.js";
import { getGitHubClient } from "../github/client.js";
import { parseInput } from "../schemas/index.js";
import { logger } from "../utils/logging.js";
import { createCommitTool } from "./create-commit.js";
import { createIssueTool } from "./create-issue.js";
import { createRepositoryTool } from "./create-repository.js";
import { listIssuesTool } from "./list-issues.js";
import { listRepositoriesTool } from "./list-repositories.js";
import type { ToolDefinition } from "./types.js";

/** Todas las tools que expone el server. Para agregar una nueva, basta con sumarla aquí. */
export const tools: ToolDefinition[] = [
  createRepositoryTool,
  createIssueTool,
  listRepositoriesTool,
  createCommitTool,
  listIssuesTool,
] as ToolDefinition[];

/**
 * Ejecuta una tool y SIEMPRE devuelve un resultado MCP, nunca lanza.
 *
 * Si algo falla, el error se devuelve como texto con `isError: true`.
 * Así el LLM lee el mensaje en lenguaje natural ("El repositorio X no fue
 * encontrado...") y puede explicarlo al usuario o corregirse y reintentar,
 * en lugar de recibir un fallo genérico del protocolo.
 */
export async function runTool(
  tool: ToolDefinition,
  args: unknown,
  getClient: () => Octokit = getGitHubClient,
): Promise<CallToolResult> {
  const started = Date.now();
  try {
    // El SDK ya valida con el schema; se valida otra vez para que runTool sea
    // seguro aunque se llame directamente (por ejemplo, desde los tests)
    const input = parseInput(tool.inputSchema, args ?? {});
    const text = await tool.execute(getClient(), input);
    logger.info("Tool ejecutada", { tool: tool.name, ms: Date.now() - started });
    return { content: [{ type: "text", text }] };
  } catch (error) {
    logger.warn("Tool con error", { tool: tool.name, ms: Date.now() - started, error });
    return { content: [{ type: "text", text: formatErrorForLLM(error) }], isError: true };
  }
}

/** Registra todas las tools en el McpServer. */
export function registerTools(server: McpServer, getClient: () => Octokit = getGitHubClient): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (args: unknown) => runTool(tool, args, getClient),
    );
  }
  logger.debug("Tools registradas", { tools: tools.map((t) => t.name) });
}
