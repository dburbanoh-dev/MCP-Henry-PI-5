#!/usr/bin/env node
/**
 * Entry point del MCP server de GitHub.
 *
 * Arquitectura: Antigravity (Host) -> LLM / MCP Client -> este server -> GitHub API
 *
 * El host lanza este proceso y se comunica con él por stdio usando JSON-RPC:
 * los mensajes del protocolo viajan por stdin/stdout y los logs van a stderr.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, tools } from "./tools/index.js";
import { logger } from "./utils/logging.js";

export const SERVER_NAME = "github-mcp-server";
export const SERVER_VERSION = "1.0.0";

// El host puede lanzar el proceso desde cualquier carpeta, así que el .env se
// busca junto al proyecto (dist/../.env), no en el directorio actual.
// - quiet: dotenv 17+ imprime un aviso en stdout, lo que rompería el protocolo.
// - Las variables definidas en la config del host tienen prioridad sobre el .env.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(projectRoot, ".env"), quiet: true });

async function main(): Promise<void> {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MCP server iniciado (stdio)", {
    version: SERVER_VERSION,
    tools: tools.map((tool) => tool.name),
    // La clave no puede contener "token": el logger la ocultaría como dato sensible
    githubAuth: process.env.GITHUB_TOKEN ? "configurado" : "FALTA",
  });

  const shutdown = async (signal: string) => {
    logger.info("Cerrando MCP server", { signal });
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  logger.error("Promesa rechazada sin manejar", { error: reason });
});

main().catch((error) => {
  logger.error("No se pudo iniciar el MCP server", { error });
  process.exit(1);
});
