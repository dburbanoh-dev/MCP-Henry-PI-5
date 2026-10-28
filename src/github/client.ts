import { Octokit } from "@octokit/rest";
import { AuthenticationError } from "../errors/index.js";
import { logger } from "../utils/logging.js";

/**
 * Configuración de Octokit (cliente oficial de la API de GitHub).
 *
 * El token se lee de la variable de entorno GITHUB_TOKEN y nunca se escribe
 * en el código ni en los logs. Si falta, se lanza un AuthenticationError con
 * instrucciones, en lugar de dejar que GitHub responda un 401 confuso.
 */

/** Lee y valida el token del entorno. */
export function getToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new AuthenticationError(
      "No se encontró GITHUB_TOKEN. Crea un Personal Access Token en https://github.com/settings/tokens " +
        "(classic con scopes repo, user y admin:org, o fine-grained con permisos Administration, Contents e Issues " +
        "en Read and write) y agrégalo a tu .env o a la configuración del MCP server en Antigravity.",
    );
  }
  return token;
}

/** Crea un cliente de Octokit autenticado. */
export function createGitHubClient(token: string = getToken()): Octokit {
  return new Octokit({
    auth: token,
    userAgent: "github-mcp-server/1.0.0",
    // Los logs internos de Octokit pasan por nuestro logger (stderr + sin secretos).
    // Octokit registra cada request HTTP en "info": se bajan a "debug" para no
    // llenar los logs; con LOG_LEVEL=debug se ven todas las llamadas a GitHub.
    log: {
      debug: (message: string) => logger.debug(message),
      info: (message: string) => logger.debug(message),
      warn: (message: string) => logger.warn(message),
      error: (message: string) => logger.error(message),
    },
  });
}

let client: Octokit | undefined;

/**
 * Devuelve un único cliente compartido (patrón singleton), creado la primera
 * vez que se necesita. Así el server puede arrancar aunque falte el token, y
 * el error aparece recién cuando el LLM intenta usar un tool, con un mensaje claro.
 */
export function getGitHubClient(): Octokit {
  client ??= createGitHubClient();
  return client;
}

/** Solo para tests: descarta el cliente compartido. */
export function resetGitHubClient(): void {
  client = undefined;
}
