import { z } from "zod";
import { fromZodError } from "../errors/index.js";

/**
 * Schemas de Zod de cada tool.
 *
 * Cumplen dos funciones:
 * 1. Validar lo que manda el LLM ANTES de llamar a GitHub, para que un
 *    input inválido nunca llegue a la API y el error sea claro.
 * 2. Documentar los parámetros: el SDK de MCP convierte estos schemas a
 *    JSON Schema y el LLM lee cada `.describe()` para decidir qué enviar.
 *    Una buena descripción es tan importante como la validación.
 */

/* ------------------------------------------------------------------ */
/* Bloques reutilizables                                               */
/* ------------------------------------------------------------------ */

/** Usuario u organización de GitHub: 1-39 caracteres, alfanuméricos y guiones simples. */
export const ownerSchema = z
  .string()
  .trim()
  .min(1, "El owner no puede estar vacío")
  .max(39, "El owner no puede superar 39 caracteres")
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/,
    "El owner solo puede tener letras, números y guiones (sin guion al inicio, al final ni dobles)",
  )
  .describe("Usuario u organización dueña del repositorio. Si se omite, se usa el usuario autenticado.");

/**
 * Nombre para un repositorio NUEVO (regla del proyecto):
 * 3-100 caracteres, solo letras, números y guiones, sin empezar ni terminar en guion.
 */
export const newRepoNameSchema = z
  .string()
  .trim()
  .min(3, "El nombre del repositorio debe tener al menos 3 caracteres")
  .max(100, "El nombre del repositorio no puede superar 100 caracteres")
  .regex(
    /^[A-Za-z0-9-]+$/,
    "El nombre del repositorio solo puede tener letras, números y guiones (sin espacios ni símbolos)",
  )
  .refine((name) => !name.startsWith("-") && !name.endsWith("-"), {
    message: "El nombre del repositorio no puede empezar ni terminar con guion",
  });

/**
 * Nombre de un repositorio que YA EXISTE. Es más flexible que el de creación
 * porque GitHub también permite puntos y guiones bajos (ej: "mi_repo.github.io"),
 * y rechazar esos nombres impediría trabajar con repos reales del usuario.
 */
export const existingRepoNameSchema = z
  .string()
  .trim()
  .min(1, "El nombre del repositorio no puede estar vacío")
  .max(100, "El nombre del repositorio no puede superar 100 caracteres")
  .regex(/^[A-Za-z0-9._-]+$/, "El nombre del repositorio solo puede tener letras, números, '.', '_' y '-'")
  .refine((name) => name !== "." && name !== "..", { message: "El nombre del repositorio no es válido" })
  .describe("Nombre del repositorio (sin el owner). Ejemplo: mi-proyecto");

/** Paginación común a los tools de listado. */
const perPageSchema = z
  .number()
  .int("perPage debe ser un número entero")
  .min(1, "perPage debe ser al menos 1")
  .max(100, "perPage no puede superar 100 (límite de GitHub)")
  .default(30)
  .describe("Cantidad de resultados por página (1-100). Por defecto 30.");

const pageSchema = z
  .number()
  .int("page debe ser un número entero")
  .min(1, "page debe ser al menos 1")
  .default(1)
  .describe("Número de página, empezando en 1.");

/** Nombre de branch según las reglas de git (simplificadas). */
export const branchSchema = z
  .string()
  .trim()
  .min(1, "El nombre de la branch no puede estar vacío")
  .max(255, "El nombre de la branch es demasiado largo")
  .refine(
    (b) =>
      !/[\s~^:?*[\\]/.test(b) &&
      !b.includes("..") &&
      !b.includes("//") &&
      !b.startsWith("/") &&
      !b.startsWith("-") &&
      !b.endsWith("/") &&
      !b.endsWith(".") &&
      !b.endsWith(".lock"),
    { message: "El nombre de la branch no es válido para git (sin espacios, '..', ni caracteres ~^:?*[\\)" },
  );

/** Ruta de archivo dentro del repositorio. */
export const filePathSchema = z
  .string()
  .trim()
  .min(1, "La ruta del archivo no puede estar vacía")
  .max(400, "La ruta del archivo es demasiado larga")
  .refine((p) => !p.startsWith("/"), { message: "La ruta debe ser relativa a la raíz del repo (sin '/' al inicio)" })
  .refine((p) => !p.includes("\\"), { message: "Usa '/' como separador de carpetas, no '\\'" })
  .refine((p) => p.split("/").every((part) => part !== "" && part !== "." && part !== ".."), {
    message: "La ruta no puede tener segmentos vacíos, '.' ni '..'",
  })
  .describe("Ruta del archivo desde la raíz del repositorio. Ejemplo: docs/notas.md");

/* ------------------------------------------------------------------ */
/* Schemas de cada tool                                                */
/* ------------------------------------------------------------------ */

export const createRepositorySchema = z.object({
  name: newRepoNameSchema.describe(
    "Nombre del nuevo repositorio: 3-100 caracteres, solo letras, números y guiones. Ejemplo: mi-api-rest",
  ),
  description: z
    .string()
    .trim()
    .max(350, "La descripción no puede superar 350 caracteres")
    .optional()
    .describe("Descripción corta del repositorio (opcional, máximo 350 caracteres)."),
  private: z.boolean().default(false).describe("true para crear un repositorio privado. Por defecto es público."),
  autoInit: z
    .boolean()
    .default(true)
    .describe("true para crear el repositorio con un README inicial (recomendado para poder hacer commits)."),
});

export const createIssueSchema = z.object({
  owner: ownerSchema.optional(),
  repo: existingRepoNameSchema,
  title: z
    .string()
    .trim()
    .min(1, "El título del issue no puede estar vacío")
    .max(256, "El título del issue no puede superar 256 caracteres")
    .describe("Título del issue, claro y corto."),
  body: z
    .string()
    .max(65_536, "El cuerpo del issue no puede superar 65536 caracteres")
    .optional()
    .describe("Descripción del issue en Markdown (opcional)."),
  labels: z
    .array(z.string().trim().min(1, "Un label no puede estar vacío").max(50, "Un label no puede superar 50 caracteres"))
    .max(20, "Máximo 20 labels por issue")
    .optional()
    .describe("Labels a asignar (opcional). Ejemplo: [\"bug\", \"urgente\"]"),
});

export const listRepositoriesSchema = z.object({
  visibility: z
    .enum(["all", "public", "private"], { message: "visibility debe ser all, public o private" })
    .default("all")
    .describe("Filtrar por visibilidad. Por defecto all."),
  sort: z
    .enum(["created", "updated", "pushed", "full_name"], {
      message: "sort debe ser created, updated, pushed o full_name",
    })
    .default("updated")
    .describe("Orden de los resultados. Por defecto updated (los más recientes primero)."),
  perPage: perPageSchema,
  page: pageSchema,
});

export const createCommitSchema = z.object({
  owner: ownerSchema.optional(),
  repo: existingRepoNameSchema,
  path: filePathSchema,
  content: z
    .string()
    .max(1_000_000, "El contenido no puede superar 1.000.000 de caracteres")
    .describe("Contenido completo del archivo en texto plano. Si el archivo existe, se reemplaza."),
  message: z
    .string()
    .trim()
    .min(1, "El mensaje del commit no puede estar vacío")
    .max(500, "El mensaje del commit no puede superar 500 caracteres")
    .describe("Mensaje del commit. Ejemplo: docs: agrega guía de instalación"),
  branch: branchSchema
    .optional()
    .describe("Branch donde hacer el commit (opcional). Si se omite, se usa la branch por defecto del repo."),
});

export const listIssuesSchema = z.object({
  owner: ownerSchema.optional(),
  repo: existingRepoNameSchema,
  state: z
    .enum(["open", "closed", "all"], { message: "state debe ser open, closed o all" })
    .default("open")
    .describe("Estado de los issues. Por defecto open (abiertos)."),
  labels: z
    .array(z.string().trim().min(1, "Un label no puede estar vacío"))
    .optional()
    .describe("Filtrar por labels (opcional). Ejemplo: [\"bug\"]"),
  perPage: perPageSchema,
  page: pageSchema,
});

/* ------------------------------------------------------------------ */
/* Tipos inferidos (una sola fuente de verdad: el schema)              */
/* ------------------------------------------------------------------ */

export type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;
export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type ListRepositoriesInput = z.infer<typeof listRepositoriesSchema>;
export type CreateCommitInput = z.infer<typeof createCommitSchema>;
export type ListIssuesInput = z.infer<typeof listIssuesSchema>;

/**
 * Valida `input` con `schema`. Si es válido devuelve los datos ya limpios
 * (con trim y defaults aplicados); si no, lanza un ValidationError legible.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}
