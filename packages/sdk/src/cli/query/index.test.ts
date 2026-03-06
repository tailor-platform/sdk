import { beforeEach, describe, expect, test, vi } from "vitest";
import { query } from "./index";

const mockClient = {
  getApplication: vi.fn(),
  getAuthMachineUser: vi.fn(),
};

vi.mock("../shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("../shared/client", () => ({
  initOperatorClient: vi.fn(),
  fetchMachineUserToken: vi.fn(),
}));

vi.mock("../shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../bundler/query/query-bundler", () => ({
  bundleQueryScript: vi.fn(),
}));

vi.mock("../shared/script-executor", () => ({
  executeScript: vi.fn(),
}));

vi.mock("../shared/config", () => ({
  extractAllNamespaces: vi.fn(),
}));

vi.mock("../shared/tailordb-namespace", () => ({
  resolveTypeNamespaces: vi.fn(),
}));

vi.mock("./sql-type-extractor", () => ({
  extractTypeNamesFromSql: vi.fn(),
  extractColumnTemplate: vi.fn(),
}));

vi.mock("./type-field-order", () => ({
  loadTypeFieldOrder: vi.fn(),
}));

describe("query", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { loadAccessToken, loadWorkspaceId } = await import("../shared/context");
    const { initOperatorClient, fetchMachineUserToken } = await import("../shared/client");
    const { loadConfig } = await import("../shared/config-loader");
    const { extractAllNamespaces } = await import("../shared/config");
    const { bundleQueryScript } = await import("../bundler/query/query-bundler");
    const { executeScript } = await import("../shared/script-executor");
    const { resolveTypeNamespaces } = await import("../shared/tailordb-namespace");
    const { extractTypeNamesFromSql, extractColumnTemplate } = await import("./sql-type-extractor");
    const { loadTypeFieldOrder } = await import("./type-field-order");

    vi.mocked(loadAccessToken).mockResolvedValue("access-token");
    vi.mocked(loadWorkspaceId).mockReturnValue("workspace-1");
    vi.mocked(initOperatorClient).mockResolvedValue(mockClient as never);
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        name: "sample-app",
      },
    } as never);
    vi.mocked(extractAllNamespaces).mockReturnValue(["tailordb"]);
    vi.mocked(bundleQueryScript).mockResolvedValue("export async function main() {}\n");
    vi.mocked(executeScript).mockResolvedValue({
      success: true,
      logs: "",
      result: '{"rows":[{"id":"1"}],"rowCount":1}',
    });
    vi.mocked(fetchMachineUserToken).mockResolvedValue({ access_token: "mu-token" } as never);
    vi.mocked(resolveTypeNamespaces).mockResolvedValue(new Map([["User", "tailordb"]]));
    vi.mocked(extractTypeNamesFromSql).mockReturnValue(["User"]);
    vi.mocked(extractColumnTemplate).mockReturnValue(null);
    vi.mocked(loadTypeFieldOrder).mockResolvedValue(new Map());

    mockClient.getApplication.mockResolvedValue({
      application: {
        url: "https://app.example.com",
        authNamespace: "auth",
      },
    });
    mockClient.getAuthMachineUser.mockResolvedValue({
      machineUser: {
        name: "bot",
        clientId: "client-id",
        clientSecret: "client-secret",
      },
    });
  });

  test("executes SQL query with bundled script and inferred namespace", async () => {
    const { executeScript } = await import("../shared/script-executor");
    const { bundleQueryScript } = await import("../bundler/query/query-bundler");
    const { resolveTypeNamespaces } = await import("../shared/tailordb-namespace");

    const result = await query({
      workspaceId: "workspace-1",
      configPath: "tailor.config.ts",
      engine: "sql",
      machineUser: "bot",
      query: 'select * from "User";',
    });

    expect(bundleQueryScript).toHaveBeenCalledWith("sql");
    expect(resolveTypeNamespaces).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        name: "query-sql-tailordb.js",
        code: "export async function main() {}\n",
      }),
    );

    expect(result).toEqual({
      engine: "sql",
      namespace: "tailordb",
      query: 'select * from "User";',
      result: {
        rows: [{ id: "1" }],
        rowCount: 1,
      },
    });
  });

  test("resolves namespace from SQL type names when multiple namespaces exist", async () => {
    const { extractAllNamespaces } = await import("../shared/config");
    const { resolveTypeNamespaces } = await import("../shared/tailordb-namespace");
    const { executeScript } = await import("../shared/script-executor");

    vi.mocked(extractAllNamespaces).mockReturnValue(["crm", "sales"]);
    vi.mocked(resolveTypeNamespaces).mockResolvedValue(new Map([["User", "sales"]]));

    await query({
      workspaceId: "workspace-1",
      configPath: "tailor.config.ts",
      engine: "sql",
      machineUser: "bot",
      query: 'select * from "User";',
    });

    expect(resolveTypeNamespaces).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      namespaces: ["crm", "sales"],
      typeNames: ["User"],
      client: mockClient,
    });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "query-sql-sales.js",
      }),
    );
  });

  test("accepts blank SQL query string without schema validation error", async () => {
    const result = await query({
      workspaceId: "workspace-1",
      configPath: "tailor.config.ts",
      engine: "sql",
      machineUser: "bot",
      query: "   ",
    });

    expect(result).toEqual({
      engine: "sql",
      namespace: "tailordb",
      query: "   ",
      result: {
        rows: [{ id: "1" }],
        rowCount: 1,
      },
    });
  });

  test("throws helpful error when SQL namespace cannot be inferred", async () => {
    const { extractAllNamespaces } = await import("../shared/config");
    const { extractTypeNamesFromSql } = await import("./sql-type-extractor");

    vi.mocked(extractAllNamespaces).mockReturnValue(["crm", "sales"]);
    vi.mocked(extractTypeNamesFromSql).mockReturnValue([]);

    await expect(
      query({
        workspaceId: "workspace-1",
        configPath: "tailor.config.ts",
        engine: "sql",
        machineUser: "bot",
        query: "select 1;",
      }),
    ).rejects.toThrow("Could not infer namespace from query. Detected namespaces: crm, sales.");
  });

  test("maps SQL parser errors to CLIError with suggestion", async () => {
    const { executeScript } = await import("../shared/script-executor");

    vi.mocked(executeScript).mockResolvedValue({
      success: false,
      logs: "",
      result: "",
      error: "sqlaccess error: failed to parse: expected token at line 1",
    });

    try {
      await query({
        workspaceId: "workspace-1",
        configPath: "tailor.config.ts",
        engine: "sql",
        machineUser: "bot",
        query: "select from",
      });
      throw new Error("expected query() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe("CLIError");
      expect((error as Error).message).toBe("SQL parse error.");
      expect((error as { suggestion?: string }).suggestion).toBe("expected token at line 1");
    }
  });

  test("executes GraphQL query via machine user token flow", async () => {
    const { executeScript } = await import("../shared/script-executor");
    const { fetchMachineUserToken } = await import("../shared/client");

    vi.mocked(executeScript).mockResolvedValue({
      success: true,
      logs: "",
      result: "raw graphql result",
    });

    const result = await query({
      workspaceId: "workspace-1",
      configPath: "tailor.config.ts",
      engine: "gql",
      machineUser: "bot",
      query: "{ viewer { id } }",
    });

    expect(fetchMachineUserToken).toHaveBeenCalledWith(
      "https://app.example.com",
      "client-id",
      "client-secret",
    );
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "query-gql.js",
        arg: JSON.stringify({
          endpoint: "https://app.example.com/query",
          accessToken: "mu-token",
          query: "{ viewer { id } }",
        }),
      }),
    );

    expect(result).toEqual({
      engine: "gql",
      query: "{ viewer { id } }",
      result: "raw graphql result",
    });
  });

  test("throws when application has no auth namespace", async () => {
    mockClient.getApplication.mockResolvedValue({
      application: {
        url: "https://app.example.com",
      },
    });

    await expect(
      query({
        workspaceId: "workspace-1",
        configPath: "tailor.config.ts",
        engine: "gql",
        machineUser: "bot",
        query: "{ viewer { id } }",
      }),
    ).rejects.toThrow("Application sample-app does not have an auth configuration.");
  });

  test("throws when machine user does not exist", async () => {
    mockClient.getAuthMachineUser.mockResolvedValue({ machineUser: undefined });

    await expect(
      query({
        workspaceId: "workspace-1",
        configPath: "tailor.config.ts",
        engine: "gql",
        machineUser: "missing-user",
        query: "{ viewer { id } }",
      }),
    ).rejects.toThrow("Machine user missing-user not found.");
  });

  test("reorders SQL result columns by type field definition order when wildcard is used", async () => {
    const { executeScript } = await import("../shared/script-executor");
    const { extractColumnTemplate } = await import("./sql-type-extractor");
    const { loadTypeFieldOrder } = await import("./type-field-order");

    vi.mocked(extractColumnTemplate).mockReturnValue([{ type: "wildcard", typeNames: ["User"] }]);
    vi.mocked(loadTypeFieldOrder).mockResolvedValue(
      new Map([["User", ["name", "email", "role", "createdAt", "updatedAt"]]]),
    );
    vi.mocked(executeScript).mockResolvedValue({
      success: true,
      logs: "",
      result: JSON.stringify({
        rows: [
          {
            updatedAt: "2024-01-02",
            email: "a@b.com",
            id: "1",
            role: "STAFF",
            name: "Alice",
            createdAt: "2024-01-01",
          },
        ],
        rowCount: 1,
      }),
    });

    const result = await query({
      workspaceId: "workspace-1",
      configPath: "tailor.config.ts",
      engine: "sql",
      machineUser: "bot",
      query: 'select * from "User";',
    });

    expect(result.engine).toBe("sql");
    const sqlResult = result.result as { rows: Record<string, unknown>[]; rowCount: number };
    expect(Object.keys(sqlResult.rows[0])).toEqual([
      "id",
      "name",
      "email",
      "role",
      "createdAt",
      "updatedAt",
    ]);
  });

  test("preserves SQL declaration order for explicit columns around wildcard expansion", async () => {
    const { executeScript } = await import("../shared/script-executor");
    const { extractColumnTemplate } = await import("./sql-type-extractor");
    const { loadTypeFieldOrder } = await import("./type-field-order");

    vi.mocked(extractColumnTemplate).mockReturnValue([
      { type: "explicit", name: "orderId" },
      { type: "wildcard", typeNames: ["User"] },
      { type: "explicit", name: "orderName" },
    ]);
    vi.mocked(loadTypeFieldOrder).mockResolvedValue(
      new Map([["User", ["name", "email", "role", "createdAt", "updatedAt"]]]),
    );
    vi.mocked(executeScript).mockResolvedValue({
      success: true,
      logs: "",
      result: JSON.stringify({
        rows: [
          {
            orderName: "Order-A",
            email: "a@b.com",
            orderId: "o1",
            role: "STAFF",
            name: "Alice",
            createdAt: "2024-01-01",
            id: "1",
            updatedAt: "2024-01-02",
          },
        ],
        rowCount: 1,
      }),
    });

    const result = await query({
      workspaceId: "workspace-1",
      configPath: "tailor.config.ts",
      engine: "sql",
      machineUser: "bot",
      query:
        'select o.id as "orderId", u.*, o.name as "orderName" from "User" u join "Order" o on u.id = o."userId";',
    });

    expect(result.engine).toBe("sql");
    const sqlResult = result.result as { rows: Record<string, unknown>[]; rowCount: number };
    expect(Object.keys(sqlResult.rows[0])).toEqual([
      "orderId",
      "id",
      "name",
      "email",
      "role",
      "createdAt",
      "updatedAt",
      "orderName",
    ]);
  });

  test("does not reorder columns when explicit column list is used", async () => {
    const { executeScript } = await import("../shared/script-executor");
    const { extractColumnTemplate } = await import("./sql-type-extractor");

    vi.mocked(extractColumnTemplate).mockReturnValue(null);
    vi.mocked(executeScript).mockResolvedValue({
      success: true,
      logs: "",
      result: JSON.stringify({
        rows: [{ email: "a@b.com", name: "Alice" }],
        rowCount: 1,
      }),
    });

    const result = await query({
      workspaceId: "workspace-1",
      configPath: "tailor.config.ts",
      engine: "sql",
      machineUser: "bot",
      query: 'select email, name from "User";',
    });

    const sqlResult = result.result as { rows: Record<string, unknown>[]; rowCount: number };
    expect(Object.keys(sqlResult.rows[0])).toEqual(["email", "name"]);
  });

  test("matches columns case-insensitively for unquoted SQL aliases", async () => {
    const { executeScript } = await import("../shared/script-executor");
    const { extractColumnTemplate } = await import("./sql-type-extractor");
    const { loadTypeFieldOrder } = await import("./type-field-order");

    vi.mocked(extractColumnTemplate).mockReturnValue([
      { type: "explicit", name: "uid" },
      { type: "wildcard", typeNames: ["SalesOrder"] },
    ]);
    vi.mocked(loadTypeFieldOrder).mockResolvedValue(
      new Map([["SalesOrder", ["customerID", "total", "createdAt"]]]),
    );
    vi.mocked(executeScript).mockResolvedValue({
      success: true,
      logs: "",
      result: JSON.stringify({
        rows: [
          {
            createdAt: "2024-01-01",
            UID: "u1",
            total: 100,
            id: "o1",
            customerID: "c1",
          },
        ],
        rowCount: 1,
      }),
    });

    const result = await query({
      workspaceId: "workspace-1",
      configPath: "tailor.config.ts",
      engine: "sql",
      machineUser: "bot",
      query:
        'select u.id as UID, o.* from "Customer" u join "SalesOrder" o on u.id = o."customerID";',
    });

    const sqlResult = result.result as { rows: Record<string, unknown>[]; rowCount: number };
    expect(Object.keys(sqlResult.rows[0])).toEqual([
      "UID",
      "id",
      "customerID",
      "total",
      "createdAt",
    ]);
  });
});
