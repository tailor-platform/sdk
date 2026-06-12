import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  getReplHistoryPath,
  query,
  queryCommand,
  resolveQueryCommandInput,
  resolveReplCommand,
} from "./index";

const xdgTempDir = vi.hoisted(() => `/tmp/tailor-xdg-${Date.now()}-${Math.random()}`);

vi.mock("xdg-basedir", () => ({
  xdgConfig: xdgTempDir,
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("../shared/editor", () => ({
  getConfiguredEditorCommand: vi.fn(),
  getEditorCommand: vi.fn(),
  openInEditor: vi.fn(),
}));

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

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const { readFile } = await import("node:fs/promises");
    const { getEditorCommand, openInEditor } = await import("../shared/editor");
    const { loadAccessToken, loadWorkspaceId } = await import("../shared/context");
    const { initOperatorClient, fetchMachineUserToken } = await import("../shared/client");
    const { loadConfig } = await import("../shared/config-loader");
    const { extractAllNamespaces } = await import("../shared/config");
    const { bundleQueryScript } = await import("../bundler/query/query-bundler");
    const { executeScript } = await import("../shared/script-executor");
    const { resolveTypeNamespaces } = await import("../shared/tailordb-namespace");
    const { extractTypeNamesFromSql, extractColumnTemplate } = await import("./sql-type-extractor");
    const { loadTypeFieldOrder } = await import("./type-field-order");

    vi.mocked(readFile).mockResolvedValue('select * from "User";' as never);
    vi.mocked(getEditorCommand).mockReturnValue("vim");
    vi.mocked(openInEditor).mockResolvedValue(true);
    vi.mocked(loadAccessToken).mockResolvedValue("access-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
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
    vi.mocked(fetchMachineUserToken).mockResolvedValue({
      access_token: "mu-token",
    } as never);
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

  test("rejects blank SQL query string with parse error", async () => {
    await expect(
      query({
        workspaceId: "workspace-1",
        configPath: "tailor.config.ts",
        engine: "sql",
        machineUser: "bot",
        query: "   ",
      }),
    ).rejects.toThrow("Unexpected end of input");
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

    await expect(
      query({
        workspaceId: "workspace-1",
        configPath: "tailor.config.ts",
        engine: "sql",
        machineUser: "bot",
        query: "select 1",
      }),
    ).rejects.toMatchObject({
      name: "CLIError",
      message: "SQL parse error.",
      suggestion: "expected token at line 1",
    });
  });

  test("splits multiple SQL statements and passes queries array to executeScript", async () => {
    const { executeScript } = await import("../shared/script-executor");

    vi.mocked(executeScript).mockResolvedValue({
      success: true,
      logs: "",
      result: '[{"rows":[{"n":1}],"rowCount":1},{"rows":[{"n":2}],"rowCount":1}]',
    });

    await query({
      workspaceId: "workspace-1",
      configPath: "tailor.config.ts",
      engine: "sql",
      machineUser: "bot",
      query: "SELECT 1; SELECT 2",
    });

    const call = vi.mocked(executeScript).mock.calls[0]![0]!;
    const arg = JSON.parse(call.arg ?? "{}");
    expect(arg.queries).toEqual(["SELECT 1; ", "SELECT 2"]);
  });

  test("does not split semicolons inside string literals", async () => {
    const { executeScript } = await import("../shared/script-executor");

    await query({
      workspaceId: "workspace-1",
      configPath: "tailor.config.ts",
      engine: "sql",
      machineUser: "bot",
      query: `INSERT INTO t VALUES ('hello;world')`,
    });

    const call = vi.mocked(executeScript).mock.calls[0]![0]!;
    const arg = JSON.parse(call.arg ?? "{}");
    expect(arg.queries).toHaveLength(1);
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
    const sqlResult = result.result as {
      rows: Record<string, unknown>[];
      rowCount: number;
    };
    expect(Object.keys(sqlResult.rows[0]!)).toEqual([
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
    const sqlResult = result.result as {
      rows: Record<string, unknown>[];
      rowCount: number;
    };
    expect(Object.keys(sqlResult.rows[0]!)).toEqual([
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

    const sqlResult = result.result as {
      rows: Record<string, unknown>[];
      rowCount: number;
    };
    expect(Object.keys(sqlResult.rows[0]!)).toEqual(["email", "name"]);
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

    const sqlResult = result.result as {
      rows: Record<string, unknown>[];
      rowCount: number;
    };
    expect(Object.keys(sqlResult.rows[0]!)).toEqual([
      "UID",
      "id",
      "customerID",
      "total",
      "createdAt",
    ]);
  });
});

describe("resolveQueryCommandInput", () => {
  test("accepts direct query mode", async () => {
    await expect(resolveQueryCommandInput({ query: "select 1;", engine: "sql" })).resolves.toEqual({
      mode: "query",
      query: "select 1;",
    });
  });

  test("reads query text from file", async () => {
    const { readFile } = await import("node:fs/promises");

    await expect(resolveQueryCommandInput({ file: "query.sql", engine: "sql" })).resolves.toEqual({
      mode: "query",
      query: 'select * from "User";',
    });
    expect(readFile).toHaveBeenCalledWith("query.sql", "utf-8");
  });

  test("allows both fields at input-resolution layer", async () => {
    await expect(
      resolveQueryCommandInput({ query: "select 1;", file: "query.sql", engine: "sql" }),
    ).resolves.toEqual({
      mode: "query",
      query: "select 1;",
    });
  });

  test("defaults to repl mode when query is omitted", async () => {
    await expect(resolveQueryCommandInput({ engine: "sql" })).resolves.toEqual({
      mode: "repl",
    });
  });

  test("reads edited query from a temporary file", async () => {
    const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
    const { openInEditor } = await import("../shared/editor");

    vi.mocked(mkdtemp).mockResolvedValue("/tmp/tailor-query-123");
    vi.mocked(readFile).mockResolvedValueOnce("select 1;");

    await expect(resolveQueryCommandInput({ edit: true, engine: "sql" })).resolves.toEqual({
      mode: "query",
      query: "select 1;",
    });

    expect(writeFile).toHaveBeenCalledWith("/tmp/tailor-query-123/query.sql", "", "utf-8");
    expect(openInEditor).toHaveBeenCalledWith("/tmp/tailor-query-123/query.sql", "vim");
    expect(rm).toHaveBeenCalledWith("/tmp/tailor-query-123", {
      recursive: true,
      force: true,
    });
  });

  test("aborts edited query when the editor output is empty", async () => {
    const { mkdtemp, readFile } = await import("node:fs/promises");

    vi.mocked(mkdtemp).mockResolvedValue("/tmp/tailor-query-123");
    vi.mocked(readFile).mockResolvedValueOnce("   ");

    await expect(resolveQueryCommandInput({ edit: true, engine: "gql" })).resolves.toEqual({
      mode: "abort",
    });
  });

  test("uses fallback editor when no editor environment variable is configured", async () => {
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const { getEditorCommand, openInEditor } = await import("../shared/editor");

    vi.mocked(getEditorCommand).mockReturnValue("editor");
    vi.mocked(mkdtemp).mockResolvedValue("/tmp/tailor-query-123");
    vi.mocked(readFile).mockResolvedValueOnce("select 1;");

    await expect(resolveQueryCommandInput({ edit: true, engine: "sql" })).resolves.toEqual({
      mode: "query",
      query: "select 1;",
    });
    expect(openInEditor).toHaveBeenCalledWith("/tmp/tailor-query-123/query.sql", "editor");
  });

  test("uses graphql extension for GraphQL editor mode", async () => {
    const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
    const { openInEditor } = await import("../shared/editor");

    vi.mocked(mkdtemp).mockResolvedValue("/tmp/tailor-query-123");
    vi.mocked(readFile).mockResolvedValueOnce("query { viewer { id } }");

    await expect(resolveQueryCommandInput({ edit: true, engine: "gql" })).resolves.toEqual({
      mode: "query",
      query: "query { viewer { id } }",
    });

    expect(writeFile).toHaveBeenCalledWith("/tmp/tailor-query-123/query.graphql", "", "utf-8");
    expect(openInEditor).toHaveBeenCalledWith("/tmp/tailor-query-123/query.graphql", "vim");
  });

  test("surfaces a helpful error when the editor command fails", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { getEditorCommand, openInEditor } = await import("../shared/editor");

    vi.mocked(getEditorCommand).mockReturnValue("vim");
    vi.mocked(mkdtemp).mockResolvedValue("/tmp/tailor-query-123");
    vi.mocked(openInEditor).mockRejectedValue(new Error("spawn editor ENOENT"));

    await expect(resolveQueryCommandInput({ edit: true, engine: "sql" })).rejects.toThrow(
      'Failed to open query editor "vim": spawn editor ENOENT',
    );
  });

  test("rejects edit mode in non-interactive terminals", async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });

    try {
      await expect(resolveQueryCommandInput({ edit: true, engine: "sql" })).rejects.toThrow(
        "Non-interactive terminals are not supported. Pass -q/--query or -f/--file to run a query.",
      );
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      }
    }
  });
});

describe("resolveReplCommand", () => {
  test("accepts quit aliases", () => {
    expect(resolveReplCommand("\\q")).toBe("quit");
    expect(resolveReplCommand("\\quit")).toBe("quit");
  });

  test("accepts help aliases", () => {
    expect(resolveReplCommand("\\help")).toBe("help");
    expect(resolveReplCommand("\\h")).toBe("help");
    expect(resolveReplCommand("\\?")).toBe("help");
  });

  test("accepts clear aliases", () => {
    expect(resolveReplCommand("\\clear")).toBe("clear");
    expect(resolveReplCommand("\\c")).toBe("clear");
  });

  test("returns null for non-command input", () => {
    expect(resolveReplCommand("select 1;")).toBeNull();
  });

  test("returns unknown for unsupported backslash command", () => {
    expect(resolveReplCommand("\\noop")).toBe("unknown");
  });
});

describe("queryCommand args", () => {
  test("rejects when query and file are both passed", () => {
    const result = queryCommand.args.safeParse({
      engine: "sql",
      query: "select 1;",
      file: "query.sql",
      "machine-user": "bot",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected args parsing to fail");
    }
    expect(result.error.issues[0]?.message).toBe("Pass either -q/--query or -f/--file, not both.");
  });

  test("rejects when edit and query are both passed", () => {
    const result = queryCommand.args.safeParse({
      engine: "sql",
      edit: true,
      query: "select 1;",
      "machine-user": "bot",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected args parsing to fail");
    }
    expect(result.error.issues[0]?.message).toBe(
      "Pass only one of --edit, -q/--query, or -f/--file.",
    );
  });

  test("rejects when edit and file are both passed", () => {
    const result = queryCommand.args.safeParse({
      engine: "sql",
      edit: true,
      file: "query.sql",
      "machine-user": "bot",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected args parsing to fail");
    }
    expect(result.error.issues[0]?.message).toBe(
      "Pass only one of --edit, -q/--query, or -f/--file.",
    );
  });

  test("newline-on-enter is optional and passes boolean through", () => {
    const omitted = queryCommand.args.safeParse({
      engine: "sql",
      "machine-user": "bot",
    });
    expect(omitted.success).toBe(true);
    if (!omitted.success) throw new Error("expected args parsing to succeed");
    expect(omitted.data["newline-on-enter"]).toBeUndefined();

    const disabled = queryCommand.args.safeParse({
      engine: "sql",
      "machine-user": "bot",
      "newline-on-enter": false,
    });
    expect(disabled.success).toBe(true);
    if (!disabled.success) throw new Error("expected args parsing to succeed");
    expect(disabled.data["newline-on-enter"]).toBe(false);
  });
});

describe("getReplHistoryPath", () => {
  test("returns an unscoped filename when neither profile nor workspaceId is set", () => {
    expect(getReplHistoryPath("sql", undefined, undefined)).toBe(
      `${xdgTempDir}/tailor-platform/query-history-sql.json`,
    );
    expect(getReplHistoryPath("gql", undefined, undefined)).toBe(
      `${xdgTempDir}/tailor-platform/query-history-gql.json`,
    );
  });

  test("treats an empty-string profile or workspaceId as unset", () => {
    expect(getReplHistoryPath("sql", "", "")).toBe(
      `${xdgTempDir}/tailor-platform/query-history-sql.json`,
    );
  });

  test("scopes by profile when only profile is set", () => {
    expect(getReplHistoryPath("sql", "dev", undefined)).toBe(
      `${xdgTempDir}/tailor-platform/query-history-sql-dev.json`,
    );
  });

  test("scopes by workspaceId when only workspaceId is set", () => {
    expect(getReplHistoryPath("gql", undefined, "ws-abc-123")).toBe(
      `${xdgTempDir}/tailor-platform/query-history-gql-ws-abc-123.json`,
    );
  });

  test("combines profile and workspaceId when both are set", () => {
    expect(getReplHistoryPath("sql", "prod", "ws-abc-123")).toBe(
      `${xdgTempDir}/tailor-platform/query-history-sql-prod-ws-abc-123.json`,
    );
  });

  test("sanitizes unsafe characters in the scope so the filename stays safe", () => {
    expect(getReplHistoryPath("sql", "team/dev prod", "ws/1..2")).toBe(
      `${xdgTempDir}/tailor-platform/query-history-sql-team_dev_prod-ws_1..2.json`,
    );
  });
});
