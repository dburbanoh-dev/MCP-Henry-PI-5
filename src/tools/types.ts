import type { Octokit } from "@octokit/rest";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

/**
 * Forma común de todas las tools.
 *
 * Cada tool declara su nombre, una descripción pensada para el LLM, su schema
 * de Zod y una función `execute` que hace el trabajo y devuelve el texto que
 * leerá el agente. El registro en el server y el manejo de errores son iguales
 * para todas, así que viven en un solo lugar (tools/index.ts).
 */
export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  /** Lo que lee el LLM para decidir CUÁNDO usar la tool. */
  description: string;
  inputSchema: S;
  /** Pistas para el host: si solo lee, si es destructiva, etc. */
  annotations: ToolAnnotations;
  execute: (octokit: Octokit, input: z.output<S>) => Promise<string>;
}

/** Ayuda a TypeScript a inferir el tipo de `input` a partir del schema. */
export function defineTool<S extends z.ZodObject>(tool: ToolDefinition<S>): ToolDefinition<S> {
  return tool;
}

/** Formato de respuesta: una frase para el usuario + los datos en JSON. */
export function formatResult(summary: string, data: unknown): string {
  return `${summary}\n\n${JSON.stringify(data, null, 2)}`;
}
