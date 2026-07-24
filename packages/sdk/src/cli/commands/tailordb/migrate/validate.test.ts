import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import { validateCommand } from "./validate";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { SchemaSnapshot, TailorDBSnapshotType } from "./snapshot";
import type { TailorDBType as ProtoTailorDBType } from "@tailor-platform/tailor-proto/tailordb_resource_pb";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  localTypes: {} as Record<string, unknown>,
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
        loadTypes: vi.fn().mockResolvedValue(undefined),
        processNamespacePlugins: vi.fn().mockResolvedValue(undefined),
        get types() {
          return state.localTypes;
        },
      },
    ],
  })),
}));

function parsedType(name: string): TailorDBType {
  return {
    name,
    pluralForm: `${name}s`,
    fields: {
      id: { name: "id", config: { type: "uuid", required: true } },
      name: { name: "name", config: { type: "string", required: true } },
    },
    settings: {},
    forwardRelationships: {},
    backwardRelationships: {},
    permissions: {},
  };
}

function snapshotType(name: string): TailorDBSnapshotType {
  return {
    name,
    pluralForm: `${name}s`,
    fields: {
      id: { type: "uuid", required: true },
      name: { type: "string", required: true },
    },
  };
}

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

function writeInitialSchema(types: Record<string, TailorDBSnapshotType>): void {
  const snapshot: SchemaSnapshot = {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "tailordb",
    createdAt: "2026-01-01T00:00:00.000Z",
    types,
  };
  const dir = path.join(state.migrationsDir, "0000");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "schema.json"), JSON.stringify(snapshot));
}

function writeDiff(number: number, changes: unknown[]): void {
  const dir = path.join(state.migrationsDir, number.toString().padStart(4, "0"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "diff.json"),
    JSON.stringify({
      version: SCHEMA_SNAPSHOT_VERSION,
      namespace: "tailordb",
      createdAt: "2026-01-01T00:00:00.000Z",
      changes,
      hasBreakingChanges: false,
      breakingChanges: [],
      hasWarnings: false,
      warnings: [],
      requiresMigrationScript: false,
    }),
  );
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

    writeInitialSchema({ User: snapshotType("User") });
    mockConfig();
    state.localTypes = { User: parsedType("User") };

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
    writeDiff(2, []);

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

  test("rejects an unknown --namespace", async () => {
    const result = await runCommand(validateCommand, ["--namespace", "nope"]);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/not found or does not have migrations configured/);
  });
});
