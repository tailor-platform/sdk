import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/valibot";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { MIGRATION_REVIEW_REQUIRED_MARKER } from "./template-generator";
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

function markHistoryAsRebaselined(): void {
  const schemaPath = path.join(state.migrationsDir, "0000", "schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
  fs.writeFileSync(
    schemaPath,
    JSON.stringify({
      ...schema,
      rebaseline: {
        historyId: "htailordb",
        replacedHistoryId: null,
        replacedLatestMigration: 5,
      },
    }),
  );
}

function writeMigrationFile(number: number, fileName: string, content: string): void {
  const dir = path.join(state.migrationsDir, number.toString().padStart(4, "0"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

describe("tailordb migration validate", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
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
    vi.unstubAllEnvs();
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
      expect.objectContaining({ kind: "table_added", tableName: "Post" }),
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
        tableName: "User",
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

  test("treats out-of-range migration labels as unset", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    state.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m10000" } },
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.remoteSchema).toEqual({
      remoteMigrationNumber: 0,
      hasDrift: false,
      drifts: [],
      skipped: "no_migration_label",
    });
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
  });

  test("reports a repairable remote migration checkpoint as valid", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    markHistoryAsRebaselined();
    state.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0005" } },
    });
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id", "name"])],
      nextPageToken: "",
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(true);
    expect(report.remoteSchema).toEqual({
      remoteMigrationNumber: 5,
      hasDrift: false,
      drifts: [],
      checkpointRepair: {
        from: 5,
        to: 0,
        fromHistoryId: null,
        toHistoryId: "htailordb",
      },
    });
  });

  test("explains that deploy will repair a checkpoint whose schema matches the baseline", async () => {
    using stderr = captureStderr();
    markHistoryAsRebaselined();
    state.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0005" } },
    });
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id", "name"])],
      nextPageToken: "",
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    expect(stderr.output).toContain("next deploy will reset the checkpoint to 0000");
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

  test("fails when a migration has both a skip acknowledgment and migrate.ts", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], {
      requiresMigrationScript: true,
      scriptSkipped: { reason: "no data yet", acknowledgedAt: "2026-01-01T00:00:00.000Z" },
    });
    writeMigrationFile(1, "migrate.ts", "export async function main() {}");

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.migrationFiles.valid).toBe(false);
    expect(report.migrationFiles.error).toMatch(/skip acknowledgment and migrate\.ts/);
    expect(report.migrationFiles.error).toContain(
      "tailordb migration script 0001 --namespace tailordb",
    );
  });

  test("lists one clearing command per line for multiple conflicting migrations", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    for (const migrationNumber of [1, 2]) {
      writeDiff(state.migrationsDir, migrationNumber, [], {
        requiresMigrationScript: true,
        scriptSkipped: { reason: "no data yet", acknowledgedAt: "2026-01-01T00:00:00.000Z" },
      });
      writeMigrationFile(migrationNumber, "migrate.ts", "export async function main() {}");
    }

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.migrationFiles.error).toContain("0001, 0002");
    expect(report.migrationFiles.error).toContain(
      "\n  tailor tailordb migration script 0001 --namespace tailordb\n",
    );
    expect(report.migrationFiles.error).toContain(
      "\n  tailor tailordb migration script 0002 --namespace tailordb\n",
    );
  });

  test("fails when a migration script still contains a generated review marker", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(
      1,
      "migrate.ts",
      `// ${MIGRATION_REVIEW_REQUIRED_MARKER}\nexport async function main() {}`,
    );

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.migrationFiles.valid).toBe(false);
    expect(report.migrationFiles.error).toContain("0001");
    expect(report.migrationFiles.error).toContain(MIGRATION_REVIEW_REQUIRED_MARKER);
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
  });

  test("accepts a migration script after its generated review marker is removed", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(1, "migrate.ts", "export async function main() {}");

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.migrationFiles).toEqual({ valid: true });
  });

  test("accepts unrelated TODO comments in migration scripts", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(
      1,
      "migrate.ts",
      "// TODO: Add observability\nexport async function main() {}",
    );

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.migrationFiles).toEqual({ valid: true });
  });

  test("ignores generated review markers outside migrate.ts", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(1, "migrate.ts", "export async function main() {}");
    writeMigrationFile(1, "db.ts", `// ${MIGRATION_REVIEW_REQUIRED_MARKER}`);

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
      expect.objectContaining({ kind: "table_added", tableName: "Post" }),
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

  const removalWarning = { tableName: "User", fieldName: "email", reason: "Field removed" };

  test("--strict fails when a pending migration has unacknowledged warnings", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { hasWarnings: true, warnings: [removalWarning] });

    const result = await runCommand(validateCommand, ["--strict"]);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.warningAcknowledgments).toEqual({
      valid: false,
      missing: [{ migrationNumber: 1, warnings: [removalWarning] }],
    });
  });

  test("--strict names the affected field and shows the acknowledgment command", async () => {
    using stderr = captureStderr();
    writeDiff(state.migrationsDir, 1, [], { hasWarnings: true, warnings: [removalWarning] });

    const result = await runCommand(validateCommand, ["--strict"]);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain("User.email");
    expect(stderr.output).toContain(
      "tailor tailordb migration script 0001 --namespace tailordb --no-script --reason '<reason>'",
    );
  });

  test("--strict includes the active --config in the acknowledgment command", async () => {
    using stderr = captureStderr();
    writeDiff(state.migrationsDir, 1, [], { hasWarnings: true, warnings: [removalWarning] });

    const result = await runCommand(validateCommand, ["--strict", "--config", "custom.config.ts"]);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain(
      "tailor tailordb migration script 0001 --namespace tailordb --config=custom.config.ts --no-script --reason '<reason>'",
    );
  });

  test("--strict shell-quotes a config path with shell-special characters", async () => {
    using stderr = captureStderr();
    writeDiff(state.migrationsDir, 1, [], { hasWarnings: true, warnings: [removalWarning] });
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const result = await runCommand(validateCommand, ["--strict", "--config", "weird $config.ts"]);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain("'--config=weird $config.ts' --no-script");
  });

  test("--strict keeps a leading-hyphen config path bound as the option value", async () => {
    using stderr = captureStderr();
    writeDiff(state.migrationsDir, 1, [], { hasWarnings: true, warnings: [removalWarning] });

    const result = await runCommand(validateCommand, ["--strict", "--config=-local.config.ts"]);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain("--config=-local.config.ts --no-script");
  });

  test("--strict renders the hint as argv for Windows-expandable config paths", async () => {
    using stderr = captureStderr();
    writeDiff(state.migrationsDir, 1, [], { hasWarnings: true, warnings: [removalWarning] });
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    const result = await runCommand(validateCommand, [
      "--strict",
      "--config",
      "%APPDATA%.config.ts",
    ]);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain(
      'argv ["tailor","tailordb","migration","script","0001","--namespace","tailordb","--config=%APPDATA%.config.ts","--no-script","--reason","<reason>"]',
    );
  });

  test("--strict accepts warnings acknowledged with a recorded reason", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], {
      hasWarnings: true,
      warnings: [removalWarning],
      scriptSkipped: {
        reason: "data no longer needed",
        acknowledgedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = await runCommand(validateCommand, ["--strict"]);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(true);
    expect(report.warningAcknowledgments).toEqual({ valid: true, missing: [] });
  });

  test("--strict accepts warnings covered by a migrate.ts", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { hasWarnings: true, warnings: [removalWarning] });
    fs.writeFileSync(
      path.join(state.migrationsDir, "0001", "migrate.ts"),
      "export async function main() {}",
    );

    const result = await runCommand(validateCommand, ["--strict"]);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.warningAcknowledgments).toEqual({ valid: true, missing: [] });
  });

  test("--strict ignores warnings on migrations already applied to the remote", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { hasWarnings: true, warnings: [removalWarning] });
    state.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0001" } },
    });

    const result = await runCommand(validateCommand, ["--strict"]);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.warningAcknowledgments).toEqual({ valid: true, missing: [] });
  });

  test("--strict treats an undeployed namespace's migrations as pending", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { hasWarnings: true, warnings: [removalWarning] });
    state.getMetadata.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    const result = await runCommand(validateCommand, ["--strict"]);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.warningAcknowledgments).toEqual({
      valid: false,
      missing: [{ migrationNumber: 1, warnings: [removalWarning] }],
    });
  });

  test("without --strict, unacknowledged warnings do not fail validation", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { hasWarnings: true, warnings: [removalWarning] });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report).not.toHaveProperty("warningAcknowledgments");
  });
});
