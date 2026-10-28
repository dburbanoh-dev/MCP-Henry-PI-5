import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/errors/index.js";
import {
  createCommitSchema,
  createIssueSchema,
  createRepositorySchema,
  listIssuesSchema,
  listRepositoriesSchema,
  parseInput,
} from "../src/schemas/index.js";

/** Devuelve los mensajes de error de Zod (o [] si el input es válido). */
function errorsOf(schema: { safeParse: (i: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, input: unknown) {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error!.issues.map((i) => i.message);
}

describe("createRepositorySchema", () => {
  it("acepta un nombre válido y aplica los defaults", () => {
    expect(parseInput(createRepositorySchema, { name: "  mi-api-rest  ", description: "Demo" })).toEqual({
      name: "mi-api-rest",
      description: "Demo",
      private: false,
      autoInit: true,
    });
  });

  it.each([
    ["ab", "al menos 3 caracteres"],
    ["a".repeat(101), "no puede superar 100"],
    ["mi repo", "solo puede tener letras, números y guiones"],
    ["mi_repo!", "solo puede tener letras, números y guiones"],
    ["-repo", "no puede empezar ni terminar con guion"],
  ])("rechaza el nombre %j", (name, expected) => {
    expect(errorsOf(createRepositorySchema, { name }).join(" ")).toContain(expected);
  });

  it("rechaza una descripción de más de 350 caracteres", () => {
    expect(errorsOf(createRepositorySchema, { name: "demo", description: "x".repeat(351) })).toHaveLength(1);
  });
});

describe("createIssueSchema", () => {
  it("acepta un issue válido con owner opcional omitido", () => {
    expect(errorsOf(createIssueSchema, { repo: "mi-repo", title: "Bug en login" })).toEqual([]);
  });

  it("acepta repos existentes con puntos y guiones bajos", () => {
    expect(errorsOf(createIssueSchema, { repo: "usuario.github.io", title: "x" })).toEqual([]);
    expect(errorsOf(createIssueSchema, { repo: "mi_repo", title: "x" })).toEqual([]);
  });

  it("rechaza título vacío, owner inválido y repo faltante", () => {
    expect(errorsOf(createIssueSchema, { repo: "r", title: "   " })).toContain(
      "El título del issue no puede estar vacío",
    );
    expect(errorsOf(createIssueSchema, { owner: "-malo-", repo: "r", title: "x" }).join(" ")).toContain(
      "El owner solo puede tener",
    );
    expect(errorsOf(createIssueSchema, { title: "x" })).toHaveLength(1);
  });
});

describe("listRepositoriesSchema y listIssuesSchema", () => {
  it("aplican defaults cuando no se envían parámetros", () => {
    expect(parseInput(listRepositoriesSchema, {})).toEqual({
      visibility: "all",
      sort: "updated",
      perPage: 30,
      page: 1,
    });
    expect(parseInput(listIssuesSchema, { repo: "r" })).toMatchObject({ state: "open", perPage: 30, page: 1 });
  });

  it("rechazan valores fuera de rango o no permitidos", () => {
    expect(errorsOf(listRepositoriesSchema, { perPage: 500 })).toContain("perPage no puede superar 100 (límite de GitHub)");
    expect(errorsOf(listRepositoriesSchema, { visibility: "secret" })).toContain(
      "visibility debe ser all, public o private",
    );
    expect(errorsOf(listIssuesSchema, { repo: "r", page: 0 })).toContain("page debe ser al menos 1");
  });
});

describe("createCommitSchema", () => {
  const valid = { repo: "r", path: "docs/notas.md", content: "# Hola", message: "docs: notas" };

  it("acepta un commit válido", () => {
    expect(errorsOf(createCommitSchema, valid)).toEqual([]);
    expect(errorsOf(createCommitSchema, { ...valid, branch: "feature/login" })).toEqual([]);
  });

  it.each(["/etc/passwd", "../secreto.txt", "docs//x.md", "docs\\x.md"])("rechaza la ruta %j", (path) => {
    // Una ruta puede romper varias reglas a la vez; basta con que sea rechazada
    expect(errorsOf(createCommitSchema, { ...valid, path }).length).toBeGreaterThan(0);
  });

  it.each(["mi rama", "a..b", "-rama", "rama.lock", "rama/"])("rechaza la branch %j", (branch) => {
    expect(errorsOf(createCommitSchema, { ...valid, branch })).toHaveLength(1);
  });

  it("rechaza un mensaje de commit vacío", () => {
    expect(errorsOf(createCommitSchema, { ...valid, message: "" })).toContain(
      "El mensaje del commit no puede estar vacío",
    );
  });
});

describe("parseInput", () => {
  it("lanza ValidationError con el campo y el motivo", () => {
    expect(() => parseInput(createRepositorySchema, { name: "a b" })).toThrow(ValidationError);
    try {
      parseInput(createRepositorySchema, { name: "a b" });
    } catch (error) {
      expect((error as ValidationError).issues[0]).toMatch(/^name: /);
    }
  });
});
