import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import {
  parsedType,
  snapshotType,
  writeDiff,
  writeInitialSchema,
} from "./test-helpers/schema-fixtures";
import { validateCommand } from "./validate";
import type { TailorDBType as ProtoTailorDBType } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  localTypes: {} as Record<string, unknown>,
  extraServices: [] as unknown[],
  listTailorDBTypes: vi.fn(),
  listTailorDBGQLPermissions: vi.fn(),
  getMetadata: vi.fn(),
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

vi.mock("#/cli/services/application", () => ({
  defineApplication: vi.fn(() => ({
    tailorDBServices: [
      {
        namespace: "tailordb",
        config: {},
        typeSourceInfo: {},
        loadTypes: vi.fn().mockResolvedValue(undefined),
        processNamespacePlugins: vi.fn().mockResolvedValue(undefined),
        get types() {
          return state.localTypes;
        },
      },
      ...state.extraServices,
    ],
  })),
}));

function remoteType(name: string, fieldNames: string[]): ProtoTailorDBType {
  const fields: Record<string, unknown> = {};
  for (const fieldName of fieldNames) {
    fields[fieldName] = {
      type: fieldName === "id" ? "uuid" : "string",
      required: true,
      array: false,
      index: false,
      unique: false,
      foreignKey: false,
      description: "",
      allowedValues: [],
      validate: [],
      fields: {},
    };
  }
  return {
    name,
    schema: { fields },
  } as unknown as ProtoTailorDBType;
}

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

describe("tailordb migration validate", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-validate-test-"));
    state.migrationsDir = path.join(tmpDir, "migrations");

    writeInitialSchema(state.migrationsDir, { User: snapshotType("User") });
    mockConfig();
    state.localTypes = { User: parsedType("User") };
    state.extraServices = [];

    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id", "name"])],
      nextPageToken: "",
    });
    state.listTailorDBGQLPermissions.mockResolvedValue({ permissions: [], nextPageToken: "" });
    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0000" },
      },
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      listTailorDBTypes: state.listTailorDBTypes,
      listTailorDBGQLPermissions: state.listTailorDBGQLPermissions,
      getMetadata: state.getMetadata,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("12345678-1234-4abc-8def-123456789012");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("passes when migration files, local schema, and remote schema are in sync", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual([
      {
        namespace: "tailordb",
        valid: true,
        migrationFiles: { valid: true },
        localSchema: { hasDiff: false },
        remoteSchema: { remoteMigrationNumber: 0, hasDrift: false, drifts: [] },
      },
    ]);
  });

  test("fails when local types have changes not covered by migration files", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    state.localTypes = { User: parsedType("User"), Post: parsedType("Post") };
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id", "name"])],
      nextPageToken: "",
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Migration validation failed for 1 namespace/);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.localSchema.hasDiff).toBe(true);
    expect(report.localSchema.diff.changes).toEqual([
      expect.objectContaining({ kind: "type_added", typeName: "Post" }),
    ]);
    expect(report.remoteSchema.hasDrift).toBe(false);
  });

  test("fails when a field in the migration snapshot is missing on the remote", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id"])],
      nextPageToken: "",
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.localSchema.hasDiff).toBe(false);
    expect(report.remoteSchema.hasDrift).toBe(true);
    expect(report.remoteSchema.drifts).toEqual([
      expect.objectContaining({
        kind: "field_missing_remote",
        typeName: "User",
        fieldName: "name",
      }),
    ]);
  });

  test("fails when migration files are invalid and skips the other checks", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 2, []);

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report).toEqual({
      namespace: "tailordb",
      valid: false,
      migrationFiles: {
        valid: false,
        error: expect.stringMatching(/Migration file validation failed/),
      },
    });
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
  });

  test("skips remote verification when the namespace has no migration label", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    state.getMetadata.mockResolvedValue({ metadata: { labels: {} } });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(true);
    expect(report.remoteSchema).toEqual({
      remoteMigrationNumber: 0,
      hasDrift: false,
      drifts: [],
      skipped: "no_migration_label",
    });
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
  });

  test("fails when the remote migration checkpoint is not in the local history", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    state.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0005" } },
    });
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id", "name", "email"])],
      nextPageToken: "",
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.remoteSchema).toEqual({
      remoteMigrationNumber: 5,
      hasDrift: false,
      drifts: [],
      checkpointMissingLocal: true,
    });
  });

  test("only suggests obtaining missing history when the remote checkpoint is ahead", async () => {
    using stderr = captureStderr();
    state.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0005" } },
    });
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id", "name", "email"])],
      nextPageToken: "",
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain("Pull the latest migration files");
    expect(stderr.output).not.toContain("migration sync");
  });

  test("retains drift guidance when the remote checkpoint is available locally", async () => {
    using stderr = captureStderr();
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id"])],
      nextPageToken: "",
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain("migration sync");
  });

  test("reports malformed migration file contents per namespace", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    const dir = path.join(state.migrationsDir, "0001");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "diff.json"), "{ not json");

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.migrationFiles.valid).toBe(false);
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
  });

  test("skips remote verification for an undeployed namespace", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    state.getMetadata.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(true);
    expect(report.remoteSchema.skipped).toBe("not_deployed");
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
  });

  test("fails when a migration requiring a script has no migrate.ts", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.migrationFiles.valid).toBe(false);
    expect(report.migrationFiles.error).toMatch(/require a migration script/);
  });

  test("accepts a required script skipped with an explicit acknowledgment", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], {
      requiresMigrationScript: true,
      scriptSkipped: { reason: "no data yet", acknowledgedAt: "2026-01-01T00:00:00.000Z" },
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.migrationFiles).toEqual({ valid: true });
  });

  test("fails when the remote migration state cannot be read", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    state.getMetadata.mockRejectedValue(new ConnectError("boom", Code.Internal));

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/boom/);
    const [report] = JSON.parse(stdout.output);
    expect(report).toEqual({
      namespace: "tailordb",
      valid: false,
      migrationFiles: { valid: true },
      localSchema: { hasDiff: false },
      remoteSchema: { skipped: "check_failed" },
    });
  });

  test("does not load credentials when no namespaces can be checked", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 2, []);
    vi.mocked(loadAccessToken).mockRejectedValue(new Error("Tailor Platform token not found."));

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Migration validation failed for 1 namespace/);
    expect(stdout.output).not.toBe("");
    const [report] = JSON.parse(stdout.output);
    expect(report).toEqual({
      namespace: "tailordb",
      valid: false,
      migrationFiles: {
        valid: false,
        error: expect.stringMatching(/Migration file validation failed/),
      },
    });
    expect(loadAccessToken).not.toHaveBeenCalled();
    expect(loadWorkspaceId).not.toHaveBeenCalled();
    expect(initOperatorClient).not.toHaveBeenCalled();
  });

  test("reports local schema drift before propagating credential failures", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    state.localTypes = { User: parsedType("User"), Post: parsedType("Post") };
    vi.mocked(loadAccessToken).mockRejectedValue(new Error("Tailor Platform token not found."));

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Tailor Platform token not found/);
    expect(stdout.output).not.toBe("");
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.localSchema.hasDiff).toBe(true);
    expect(report.localSchema.diff.changes).toEqual([
      expect.objectContaining({ kind: "type_added", typeName: "Post" }),
    ]);
    expect(report.remoteSchema).toEqual({ skipped: "check_failed" });
  });

  test("prints local findings before propagating credential failures", async () => {
    using stderr = captureStderr();
    state.localTypes = { User: parsedType("User"), Post: parsedType("Post") };
    vi.mocked(loadAccessToken).mockRejectedValue(new Error("Tailor Platform token not found."));

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain("Migration files:");
    expect(stderr.output).toContain("Local schema:");
    expect(stderr.output).toContain("changes not in migration files");
    expect(stderr.output).toContain("Remote schema:");
    expect(stderr.output).toContain("not checked");
    expect(stderr.output).not.toContain("All migration validation checks passed.");
  });

  test("rejects duplicate type names across namespaces like deploy does", async () => {
    state.extraServices = [
      {
        namespace: "other",
        config: {},
        typeSourceInfo: {},
        loadTypes: vi.fn().mockResolvedValue(undefined),
        processNamespacePlugins: vi.fn().mockResolvedValue(undefined),
        types: { User: parsedType("User") },
      },
    ];

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Duplicate TailorDB type names/);
  });

  test("rejects an unknown --namespace", async () => {
    const result = await runCommand(validateCommand, ["--namespace", "nope"]);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/not found or does not have migrations configured/);
  });
});
