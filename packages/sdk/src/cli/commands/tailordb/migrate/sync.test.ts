import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/valibot";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { prompt } from "#/cli/shared/prompt";
import { syncCommand } from "./sync";
import {
  parsedType,
  snapshotType,
  writeDiff,
  writeInitialSchema,
} from "./test-helpers/schema-fixtures";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  localTypes: {} as Record<string, unknown>,
  executors: {} as Record<string, unknown>,
  pluginExecutors: {} as Record<string, unknown>,
  pluginExecutorFiles: [] as string[],
  listTailorDBTypes: vi.fn(),
  createTailorDBType: vi.fn(),
  updateTailorDBType: vi.fn(),
  deleteTailorDBType: vi.fn(),
  listTailorDBGQLPermissions: vi.fn(),
  createTailorDBGQLPermission: vi.fn(),
  updateTailorDBGQLPermission: vi.fn(),
  deleteTailorDBGQLPermission: vi.fn(),
  getMetadata: vi.fn(),
  setMetadata: vi.fn(),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#/cli/shared/prompt", () => ({
  prompt: { confirm: vi.fn() },
}));

vi.mock("#/cli/services/application", () => ({
  defineApplication: vi.fn(() => ({
    tailorDBServices: [
      {
        namespace: "tailordb",
        config: {},
        loadTypes: vi.fn().mockResolvedValue(undefined),
        processNamespacePlugins: vi.fn().mockResolvedValue(undefined),
        get types() {
          return state.localTypes;
        },
      },
    ],
    executorService: {
      loadExecutors: vi.fn(() => Promise.resolve(state.executors)),
      loadPluginExecutorFiles: vi.fn(() => {
        Object.assign(state.executors, state.pluginExecutors);
        return Promise.resolve(undefined);
      }),
      get executors() {
        return state.executors;
      },
    },
  })),
  generatePluginFilesIfNeeded: vi.fn(() => state.pluginExecutorFiles),
}));

function mockConfig(namespaces: string[] = ["tailordb"]): void {
  const db: Record<string, unknown> = {};
  for (const namespace of namespaces) {
    db[namespace] = { migration: { directory: state.migrationsDir } };
  }
  vi.mocked(loadConfig).mockResolvedValue({
    config: {
      path: path.join(path.dirname(state.migrationsDir), "tailor.config.ts"),
      db,
    },
    plugins: [],
  } as unknown as Awaited<ReturnType<typeof loadConfig>>);
}

describe("tailordb migration sync", () => {
  aroundEach(async (runTest) => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-sync-test-"));
    state.migrationsDir = path.join(tmpDir, "migrations");

    writeInitialSchema(state.migrationsDir, { User: snapshotType("User") });
    writeDiff(state.migrationsDir, 1, [
      { kind: "table_added", typeName: "Post", after: snapshotType("Post") },
    ]);
    writeDiff(state.migrationsDir, 2, []);
    mockConfig();
    // Local tables matching reconstruct(latest) so the pre-apply consistency
    // check passes by default.
    state.localTypes = { User: parsedType("User"), Post: parsedType("Post") };
    state.executors = {};
    state.pluginExecutors = {};
    state.pluginExecutorFiles = [];

    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [{ name: "User" }, { name: "Stale" }],
      nextPageToken: "",
    });
    state.createTailorDBType.mockResolvedValue({});
    state.updateTailorDBType.mockResolvedValue({});
    state.deleteTailorDBType.mockResolvedValue({});
    state.listTailorDBGQLPermissions.mockResolvedValue({ permissions: [], nextPageToken: "" });
    state.createTailorDBGQLPermission.mockResolvedValue({});
    state.updateTailorDBGQLPermission.mockResolvedValue({});
    state.deleteTailorDBGQLPermission.mockResolvedValue({});
    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0002", "sdk-name": "my-app" },
      },
    });
    state.setMetadata.mockResolvedValue({});
    vi.mocked(initOperatorClient).mockResolvedValue({
      listTailorDBTypes: state.listTailorDBTypes,
      createTailorDBType: state.createTailorDBType,
      updateTailorDBType: state.updateTailorDBType,
      deleteTailorDBType: state.deleteTailorDBType,
      listTailorDBGQLPermissions: state.listTailorDBGQLPermissions,
      createTailorDBGQLPermission: state.createTailorDBGQLPermission,
      updateTailorDBGQLPermission: state.updateTailorDBGQLPermission,
      deleteTailorDBGQLPermission: state.deleteTailorDBGQLPermission,
      getMetadata: state.getMetadata,
      setMetadata: state.setMetadata,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    await runTest();

    vi.restoreAllMocks();
    state.listTailorDBTypes.mockReset();
    state.createTailorDBType.mockReset();
    state.updateTailorDBType.mockReset();
    state.deleteTailorDBType.mockReset();
    state.listTailorDBGQLPermissions.mockReset();
    state.createTailorDBGQLPermission.mockReset();
    state.updateTailorDBGQLPermission.mockReset();
    state.deleteTailorDBGQLPermission.mockReset();
    state.getMetadata.mockReset();
    state.setMetadata.mockReset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("applies creates/updates/deletes for the target snapshot and sets the label", async () => {
    const result = await runCommand(syncCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    // Snapshot at 0001 contains User (existing → update) and Post (new → create);
    // remote-only Stale is deleted.
    expect(state.createTailorDBType).toHaveBeenCalledTimes(1);
    expect(state.createTailorDBType.mock.calls[0]![0]).toMatchObject({
      namespaceName: "tailordb",
      tailordbType: { name: "Post" },
    });
    expect(state.updateTailorDBType).toHaveBeenCalledTimes(1);
    expect(state.updateTailorDBType.mock.calls[0]![0]).toMatchObject({
      namespaceName: "tailordb",
      tailordbType: { name: "User" },
    });
    expect(state.deleteTailorDBType).toHaveBeenCalledTimes(1);
    expect(state.deleteTailorDBType.mock.calls[0]![0]).toMatchObject({
      namespaceName: "tailordb",
      tailordbTypeName: "Stale",
    });
    // No remote GQL permissions exist, so none are touched.
    expect(state.deleteTailorDBGQLPermission).not.toHaveBeenCalled();
    expect(state.createTailorDBGQLPermission).not.toHaveBeenCalled();
    expect(state.updateTailorDBGQLPermission).not.toHaveBeenCalled();
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: { "sdk-migration": "m0001", "sdk-name": "my-app" },
      }),
    );
  });

  test("sets the current migration history ID from a re-baselined snapshot", async () => {
    const schemaPath = path.join(state.migrationsDir, "0000", "schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(
      schemaPath,
      JSON.stringify({
        ...schema,
        rebaseline: {
          historyId: "hcurrent",
          replacedHistoryId: null,
          replacedLatestMigration: 2,
        },
      }),
    );

    const result = await runCommand(syncCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: {
          "sdk-migration": "m0001",
          "sdk-migration-history": "hcurrent",
          "sdk-name": "my-app",
        },
      }),
    );
  });

  test("removes a stale remote history ID for a markerless local history", async () => {
    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: {
          "sdk-migration": "m0002",
          "sdk-migration-history": "hstale",
          "sdk-name": "my-app",
        },
      },
    });

    const result = await runCommand(syncCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: { "sdk-migration": "m0001", "sdk-name": "my-app" },
      }),
    );
  });

  test("reconciles GQL permissions with the snapshot", async () => {
    const gqlPolicy = { conditions: [], actions: ["read"], permit: "allow" };
    writeInitialSchema(state.migrationsDir, {
      User: { ...snapshotType("User"), permissions: { gql: [gqlPolicy] } } as ReturnType<
        typeof snapshotType
      >,
    });
    state.localTypes = {
      User: { ...(parsedType("User") as object), permissions: { gql: [gqlPolicy] } },
      Post: parsedType("Post"),
    };
    // Remote: a stale permission for a type absent from the snapshot.
    state.listTailorDBGQLPermissions.mockResolvedValue({
      permissions: [{ typeName: "Stale" }],
      nextPageToken: "",
    });

    const result = await runCommand(syncCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    // User's permission exists in the snapshot but not remotely → created.
    expect(state.createTailorDBGQLPermission).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: "tailordb", typeName: "User" }),
    );
    expect(state.updateTailorDBGQLPermission).not.toHaveBeenCalled();
    // Stale's permission has no snapshot counterpart → deleted before the table.
    expect(state.deleteTailorDBGQLPermission).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: "tailordb", typeName: "Stale" }),
    );
  });

  test("accepts 4-digit migration numbers", async () => {
    const result = await runCommand(syncCommand, ["0001", "--yes"]);
    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0001" }),
      }),
    );
  });

  test("still sets the label when namespace metadata does not exist yet", async () => {
    state.getMetadata.mockRejectedValue(new ConnectError("metadata not found", Code.NotFound));

    const result = await runCommand(syncCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: { "sdk-migration": "m0001" },
      }),
    );
  });

  test("refuses to sync when the namespace does not exist remotely", async () => {
    state.listTailorDBTypes.mockRejectedValue(
      new ConnectError("namespace not found", Code.NotFound),
    );

    const result = await runCommand(syncCommand, ["1", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/has not been deployed yet/);
    expect(state.createTailorDBType).not.toHaveBeenCalled();
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("aborts before mutating when reading metadata fails with a non-NotFound error", async () => {
    state.getMetadata.mockRejectedValue(new ConnectError("unavailable", Code.Unavailable));

    const result = await runCommand(syncCommand, ["1", "--yes"]);

    expect(result.success).toBe(false);
    expect(state.createTailorDBType).not.toHaveBeenCalled();
    expect(state.updateTailorDBType).not.toHaveBeenCalled();
    expect(state.deleteTailorDBType).not.toHaveBeenCalled();
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("includes plugin-generated executors in publishRecordEvents detection", async () => {
    state.pluginExecutorFiles = ["/tmp/plugin-executor.ts"];
    state.pluginExecutors = { onUser: { trigger: { kind: "tailordb", typeName: "User" } } };

    const result = await runCommand(syncCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.updateTailorDBType.mock.calls[0]![0]).toMatchObject({
      tailordbType: { name: "User", schema: { settings: { publishRecordEvents: true } } },
    });
  });

  test("enables publishRecordEvents for tables used by executor record triggers", async () => {
    state.executors = { onUser: { trigger: { kind: "tailordb", typeName: "User" } } };

    const result = await runCommand(syncCommand, ["1", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.updateTailorDBType.mock.calls[0]![0]).toMatchObject({
      tailordbType: { name: "User", schema: { settings: { publishRecordEvents: true } } },
    });
    expect(state.createTailorDBType.mock.calls[0]![0]).toMatchObject({
      tailordbType: { name: "Post", schema: { settings: { publishRecordEvents: false } } },
    });
  });

  test.each(["abc", "00", "01"])("rejects invalid migration number format %j", async (input) => {
    const result = await runCommand(syncCommand, [input, "--yes"]);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Invalid migration number format/);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("accepts 0 for the baseline snapshot", async () => {
    const result = await runCommand(syncCommand, ["0", "--yes"]);
    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({ "sdk-migration": "m0000" }),
      }),
    );
  });

  test("rejects when the migration directory has a gap", async () => {
    fs.rmSync(path.join(state.migrationsDir, "0001"), { recursive: true, force: true });

    const result = await runCommand(syncCommand, ["2", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Migration file validation failed/);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("rejects a migration number beyond the working tree's latest", async () => {
    const result = await runCommand(syncCommand, ["3", "--yes"]);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/does not exist in working tree/);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("requires --namespace when multiple namespaces have migrations", async () => {
    mockConfig(["tailordb", "analyticsdb"]);
    const result = await runCommand(syncCommand, ["1", "--yes"]);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/specify namespace with --namespace/);
  });

  test("rejects an unknown --namespace", async () => {
    const result = await runCommand(syncCommand, ["1", "--yes", "--namespace", "nope"]);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/not found or does not have migrations configured/);
  });

  test("refuses to apply when the migration history does not reproduce local tables", async () => {
    // Local tables lack Post, but reconstruct(latest) contains it — the
    // history (or the working tree) is inconsistent and nothing may be sent.
    state.localTypes = { User: parsedType("User") };

    const result = await runCommand(syncCommand, ["1", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/must reproduce the current local schema/);
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
    expect(state.createTailorDBType).not.toHaveBeenCalled();
    expect(state.updateTailorDBType).not.toHaveBeenCalled();
    expect(state.deleteTailorDBType).not.toHaveBeenCalled();
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("makes no changes when the confirmation prompt is declined", async () => {
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(syncCommand, ["1"]);

    expect(result.success).toBe(true);
    expect(state.createTailorDBType).not.toHaveBeenCalled();
    expect(state.updateTailorDBType).not.toHaveBeenCalled();
    expect(state.deleteTailorDBType).not.toHaveBeenCalled();
    expect(state.setMetadata).not.toHaveBeenCalled();
  });
});
