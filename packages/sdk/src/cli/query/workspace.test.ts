import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeScript } from "../shared/script-executor";
import { mockOperatorClient } from "../shared/test-helpers/operator-client";
import { silenceLogger } from "../shared/test-helpers/silence-logger";
import { writeWorkspaceProject } from "../shared/test-helpers/workspace-config";
import { query } from "./index";

const client = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(async () => "token"),
  loadWorkspaceId: vi.fn(async () => "workspace-id"),
}));

vi.mock("../shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(async () => client.current),
  fetchMachineUserToken: vi.fn(async () => ({ access_token: "machine-token" })),
}));

vi.mock("../bundler/query/query-bundler", () => ({
  bundleQueryScript: vi.fn(async () => "bundled"),
}));

vi.mock("../shared/script-executor", () => ({
  executeScript: vi.fn(async () => ({ success: true, result: "[]" })),
}));

const DEPLOYED_TABLES: Record<string, string[]> = {
  "customer-db": ["Customer"],
  "order-db": ["Order"],
  "ledger-db": ["Entry"],
};

const MACHINE_USERS: Record<string, string[]> = {
  "corp-auth": ["admin", "seeder"],
  "partner-auth": ["admin"],
};

const APPLICATIONS: Record<string, string> = {
  shop: "corp-auth",
  backoffice: "corp-auth",
  partner: "partner-auth",
};

function workspaceClient(tables = DEPLOYED_TABLES) {
  return mockOperatorClient({
    listTailorDBTypes: async ({ namespaceName }) => ({
      tailordbTypes: (tables[namespaceName ?? ""] ?? []).map((name) => ({ name })),
      nextPageToken: "",
    }),
    getAuthMachineUser: async ({ authNamespace, name }) => {
      if (!MACHINE_USERS[authNamespace ?? ""]?.includes(name ?? "")) {
        throw new ConnectError("machine user not found", Code.NotFound);
      }
      return {
        machineUser: { name, clientId: `${authNamespace}-${name}`, clientSecret: "secret" },
      };
    },
    getApplication: async ({ applicationName }) => {
      const authNamespace = APPLICATIONS[applicationName ?? ""];
      if (!authNamespace) throw new ConnectError("application not found", Code.NotFound);
      return {
        application: {
          name: applicationName,
          authNamespace,
          url: `https://${applicationName}.example`,
        },
      };
    },
  });
}

describe("query with a workspace config", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-query-")));
    configPath = writeWorkspaceProject(dir);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "");
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "");
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(dir, ".tailor"));
    silenceLogger("log", "info", "success", "warn", "debug");
    client.current = workspaceClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const sql = (q: string, options: { machineUser: string; namespace?: string }) =>
    query({ configPath, engine: "sql", query: q, ...options });

  test("infers a namespace no application lists, as the machine user of the Auth service that defines it", async () => {
    await expect(sql('SELECT * FROM "Entry"', { machineUser: "seeder" })).resolves.toMatchObject({
      namespace: "ledger-db",
    });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        arg: expect.objectContaining({ namespace: "ledger-db" }),
        invoker: expect.objectContaining({ namespace: "corp-auth", machineUserName: "seeder" }),
      }),
    );
  });

  test("runs as the Auth service a qualified machine user names", async () => {
    await sql('SELECT * FROM "Order"', { machineUser: "partner-auth/admin" });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        invoker: expect.objectContaining({ namespace: "partner-auth", machineUserName: "admin" }),
      }),
    );
  });

  test("rejects a machine user name that several Auth services define", async () => {
    await expect(sql('SELECT * FROM "Order"', { machineUser: "admin" })).rejects.toMatchObject({
      code: "MACHINE_USER_AMBIGUOUS",
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  test("rejects a table that several deployed namespaces have, and runs with --namespace", async () => {
    client.current = workspaceClient({ ...DEPLOYED_TABLES, "ledger-db": ["Entry", "Order"] });

    await expect(sql('SELECT * FROM "Order"', { machineUser: "seeder" })).rejects.toMatchObject({
      code: "TAILORDB_TABLE_NAMESPACE_AMBIGUOUS",
    });
    await expect(
      sql('SELECT * FROM "Order"', { machineUser: "seeder", namespace: "ledger-db" }),
    ).resolves.toMatchObject({ namespace: "ledger-db" });
  });

  test("rejects a --namespace the config does not define", async () => {
    await expect(
      sql('SELECT * FROM "Order"', { machineUser: "seeder", namespace: "missing-db" }),
    ).rejects.toMatchObject({ code: "TAILORDB_NAMESPACE_NOT_FOUND" });
  });

  describe("gql", () => {
    const gql = (options: { machineUser: string; app?: string }) =>
      query({ configPath, engine: "gql", query: "{ __typename }", ...options });

    test("needs --app when the workspace has several applications", async () => {
      await expect(gql({ machineUser: "seeder" })).rejects.toMatchObject({ code: "APP_REQUIRED" });
    });

    test("queries the application --app names, as its Auth service's machine user", async () => {
      await gql({ machineUser: "admin", app: "partner" });
      expect(executeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          arg: expect.objectContaining({ endpoint: "https://partner.example/query" }),
          invoker: expect.objectContaining({ namespace: "partner-auth", machineUserName: "admin" }),
        }),
      );
    });

    test("rejects a machine user of another Auth service than the application's", async () => {
      await expect(gql({ machineUser: "corp-auth/seeder", app: "partner" })).rejects.toMatchObject({
        code: "QUERY_MACHINE_USER_AUTH_MISMATCH",
      });
    });

    test("rejects an application the config does not define", async () => {
      await expect(gql({ machineUser: "admin", app: "missing" })).rejects.toMatchObject({
        code: "APP_NOT_FOUND",
      });
    });
  });

  test("rejects --namespace with the gql engine", async () => {
    await expect(
      query({
        configPath,
        engine: "gql",
        query: "{ __typename }",
        machineUser: "seeder",
        namespace: "order-db",
      }),
    ).rejects.toMatchObject({ code: "OPTIONS_INVALID" });
  });

  test("rejects --app with the sql engine", async () => {
    await expect(
      query({ configPath, engine: "sql", query: "SELECT 1", machineUser: "seeder", app: "shop" }),
    ).rejects.toMatchObject({ code: "OPTIONS_INVALID" });
  });
});
