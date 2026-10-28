import type { Octokit } from "@octokit/rest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError } from "../src/errors/index.js";
import { registerTools, runTool, tools } from "../src/tools/index.js";
import { createRepositoryTool } from "../src/tools/create-repository.js";
import { listIssuesTool } from "../src/tools/list-issues.js";

function fakeOctokit() {
  const rest = {
    users: { getAuthenticated: vi.fn().mockResolvedValue({ data: { login: "octocat" } }) },
    repos: {
      createForAuthenticatedUser: vi.fn().mockResolvedValue({
        data: {
          name: "demo",
          full_name: "octocat/demo",
          description: null,
          private: true,
          html_url: "https://github.com/octocat/demo",
          default_branch: "main",
        },
      }),
      listForAuthenticatedUser: vi.fn().mockResolvedValue({ data: [] }),
    },
    issues: { listForRepo: vi.fn().mockResolvedValue({ data: [] }) },
  };
  return { rest, octokit: { rest } as unknown as Octokit };
}

beforeEach(() => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

describe("catálogo de tools", () => {
  it("expone las 5 tools obligatorias con descripción", () => {
    expect(tools.map((t) => t.name)).toEqual([
      "create_repository",
      "create_issue",
      "list_repositories",
      "create_commit",
      "list_issues",
    ]);
    for (const tool of tools) expect(tool.description.length).toBeGreaterThan(50);
  });
});

describe("runTool", () => {
  it("devuelve un texto con resumen y datos cuando todo sale bien", async () => {
    const { octokit } = fakeOctokit();
    const result = await runTool(createRepositoryTool, { name: "demo", private: true }, () => octokit);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toContain(
      "Repositorio privado octocat/demo creado: https://github.com/octocat/demo",
    );
  });

  it("input inválido -> isError con ValidationError, sin llamar a GitHub", async () => {
    const { rest, octokit } = fakeOctokit();
    const result = await runTool(createRepositoryTool, { name: "a b" }, () => octokit);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/^Error \(VALIDATION_ERROR\): .*name:/);
    expect(rest.repos.createForAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("token faltante -> isError con instrucciones (el server no se cae)", async () => {
    const result = await runTool(createRepositoryTool, { name: "demo" }, () => {
      throw new AuthenticationError("No se encontró GITHUB_TOKEN.");
    });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Error (AUTHENTICATION_ERROR): No se encontró GITHUB_TOKEN." }],
    });
  });

  it("lista vacía -> mensaje claro en lugar de un JSON vacío", async () => {
    const { octokit } = fakeOctokit();
    const result = await runTool(listIssuesTool, { owner: "octocat", repo: "demo" }, () => octokit);
    expect((result.content[0] as { text: string }).text).toBe("No hay issues abiertos en octocat/demo.");
  });
});

describe("integración MCP (cliente <-> server en memoria)", () => {
  async function connect() {
    const { rest, octokit } = fakeOctokit();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, () => octokit);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, rest };
  }

  it("el cliente descubre las tools con su JSON Schema", async () => {
    const { client } = await connect();
    const { tools: listed } = await client.listTools();

    const createRepo = listed.find((t) => t.name === "create_repository");
    expect(listed).toHaveLength(5);
    expect(createRepo?.inputSchema.required).toEqual(["name"]);
    expect(createRepo?.annotations?.readOnlyHint).toBe(false);
  });

  it("el cliente llama a una tool y recibe el resultado", async () => {
    const { client, rest } = await connect();
    const result = await client.callTool({ name: "create_repository", arguments: { name: "demo" } });

    expect(rest.repos.createForAuthenticatedUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: "demo", private: false, auto_init: true }),
    );
    expect(JSON.stringify(result.content)).toContain("octocat/demo");
  });

  it("argumentos inválidos llegan al LLM como error de tool con el mensaje en español", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "create_repository", arguments: { name: "ab" } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("al menos 3 caracteres");
  });
});
