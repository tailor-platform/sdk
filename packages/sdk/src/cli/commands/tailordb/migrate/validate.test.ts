import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  bundleMigrationScript,
  bundleMigrationSteps,
  bundleSingleStepMigration,
} from "#/cli/commands/tailordb/migrate/bundler";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import {
  parsedType,
  remoteType,
  restrictedRemoteType,
  snapshotType,
  writeDiff,
  writeInitialSchema,
  writeRebaselineMarker,
} from "./test-helpers/schema-fixtures";
import { validateCommand } from "./validate";
import type { CLIError } from "#/cli/shared/errors";

const LEGACY_REVIEW_MARKER = "TODO(tailor-migration-review)";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  localTypes: {} as Record<string, unknown>,
  extraServices: [] as unknown[],
  authService: undefined as unknown,
  listTailorDBTypes: vi.fn(),
  listTailorDBGQLPermissions: vi.fn(),
  getMetadata: vi.fn(),
  getWorkflowExecution: vi.fn(),
  getFunctionExecution: vi.fn(),
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

vi.mock("#/cli/commands/tailordb/migrate/bundler", () => ({
  bundleMigrationScript: vi.fn(async () => ({ bundledCode: "" })),
  bundleMigrationSteps: vi.fn(async () => ({ bundledCode: "" })),
  bundleSingleStepMigration: vi.fn(async () => ({ bundledCode: "" })),
}));

vi.mock("#/cli/services/application", () => ({
  defineApplication: vi.fn(() => ({
    env: {},
    authService: state.authService,
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

function mockConfig(migration: { machineUser?: string } = {}): void {
  vi.mocked(loadConfig).mockResolvedValue({
    config: {
      path: path.join(path.dirname(state.migrationsDir), "tailor.config.ts"),
      db: { tailordb: { migration: { directory: state.migrationsDir, ...migration } } },
    },
    plugins: [],
  } as unknown as Awaited<ReturnType<typeof loadConfig>>);
}

function writeMigrationFile(number: number, fileName: string, content: string): void {
  const dir = path.join(state.migrationsDir, number.toString().padStart(4, "0"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

describe("tailordb migration validate", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.stubEnv("TAILOR_CONFIG_PATH", undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-validate-test-"));
    state.migrationsDir = path.join(tmpDir, "migrations");

    writeInitialSchema(state.migrationsDir, { User: snapshotType("User") });
    mockConfig();
    state.localTypes = { User: parsedType("User") };
    state.extraServices = [];
    state.authService = { config: { name: "auth", machineUsers: { admin: {} } } };
    vi.mocked(bundleMigrationScript).mockReset();
    vi.mocked(bundleMigrationSteps).mockReset();
    vi.mocked(bundleSingleStepMigration).mockReset();

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
    state.getWorkflowExecution.mockReset();
    state.getFunctionExecution.mockReset();
    vi.mocked(initOperatorClient).mockResolvedValue({
      listTailorDBTypes: state.listTailorDBTypes,
      listTailorDBGQLPermissions: state.listTailorDBGQLPermissions,
      getMetadata: state.getMetadata,
      getWorkflowExecution: state.getWorkflowExecution,
      getFunctionExecution: state.getFunctionExecution,
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

  test("fails when local tables have changes not covered by migration files", async () => {
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

  test("verifies a namespace without a migration label against 0000", async () => {
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
      checkpointUnset: true,
    });
  });

  test("reports that the tables of a namespace without a migration label match 0000", async () => {
    using stderr = captureStderr();
    state.getMetadata.mockResolvedValue({ metadata: { labels: {} } });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    expect(stderr.output).toContain("Remote schema: OK (no checkpoint yet; tables match 0000)");
  });

  test("fails when the tables of a namespace without a migration label differ from 0000", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    state.getMetadata.mockResolvedValue({ metadata: { labels: {} } });
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id", "name", "legacyCode"])],
      nextPageToken: "",
    });

    const result = await runCommand(validateCommand, ["--profile", "staging"]);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.remoteSchema).toMatchObject({
      remoteMigrationNumber: 0,
      hasDrift: true,
      checkpointUnset: true,
      drifts: [expect.objectContaining({ tableName: "User", fieldName: "legacyCode" })],
    });
    const { suggestion } = result.error as CLIError;
    expect(suggestion).toContain(
      "`tailor tailordb migration sync 0000 --namespace tailordb --workspace-id=12345678-1234-4abc-8def-123456789012 --profile=staging` to rewrite them to 0000, which removes the fields that 0000 does not have and deletes the tables it does not have together with their data",
    );
    expect(suggestion).toContain(
      "`tailor tailordb migration generate --init --namespace tailordb`",
    );
  });

  test("explains that a namespace without a migration label must match 0000", async () => {
    using stderr = captureStderr();
    state.getMetadata.mockResolvedValue({ metadata: { labels: {} } });
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [remoteType("User", ["id", "name", "legacyCode"])],
      nextPageToken: "",
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain(
      "Remote schema: drift detected (no checkpoint yet; compared with 0000)",
    );
    expect(stderr.output).not.toContain("migration sync <N>");
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
      checkpointUnset: true,
    });
  });

  test("reports a repairable remote migration checkpoint as valid", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeRebaselineMarker(state.migrationsDir, "htailordb", { replacedLatestMigration: 5 });
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
    writeRebaselineMarker(state.migrationsDir, "htailordb", { replacedLatestMigration: 5 });
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

  describe("a table whose deletion the checkpoint's migration did not finish", () => {
    beforeEach(() => {
      writeInitialSchema(state.migrationsDir, {
        User: snapshotType("User"),
        Legacy: snapshotType("Legacy"),
      });
      writeDiff(state.migrationsDir, 1, [
        { kind: "table_removed", tableName: "Legacy", before: snapshotType("Legacy") },
      ]);
      state.getMetadata.mockResolvedValue({
        metadata: { labels: { "sdk-migration": "m0001", "sdk-migration-cleanup": "m0001" } },
      });
      state.listTailorDBTypes.mockResolvedValue({
        tailordbTypes: [remoteType("User", ["id", "name"]), remoteType("Legacy", ["id", "name"])],
        nextPageToken: "",
      });
    });

    test("is reported as a table the next deploy deletes", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(true);
      const [report] = JSON.parse(stdout.output);
      expect(report.valid).toBe(true);
      expect(report.remoteSchema).toEqual({
        remoteMigrationNumber: 1,
        hasDrift: false,
        drifts: [],
        unfinishedRemovals: ["Legacy"],
      });
    });

    test("is explained as a table the next deploy deletes", async () => {
      using stderr = captureStderr();

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(true);
      expect(stderr.output).toContain("Remote schema: OK (remote migration: 0001)");
      expect(stderr.output).toContain(
        "The next deploy deletes Legacy, which migration 0001 removed.",
      );
    });
  });

  describe("a migration a deploy left in its Pre-phase without recording it", () => {
    beforeEach(() => {
      writeDiff(state.migrationsDir, 1, [
        { kind: "table_added", tableName: "Post", after: snapshotType("Post") },
      ]);
      state.localTypes = { User: parsedType("User"), Post: parsedType("Post") };
      state.listTailorDBTypes.mockResolvedValue({
        tailordbTypes: [
          remoteType("User", ["id", "name"]),
          restrictedRemoteType("Post", ["id", "name"]),
        ],
        nextPageToken: "",
      });
    });

    test("reports the remote schema as valid and names the migration", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(true);
      const [report] = JSON.parse(stdout.output);
      expect(report.valid).toBe(true);
      expect(report.remoteSchema).toEqual({
        remoteMigrationNumber: 0,
        hasDrift: false,
        drifts: [],
        interruptedMigration: 1,
      });
    });

    test("explains that the next deploy runs the migration again", async () => {
      using stderr = captureStderr();

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(true);
      expect(stderr.output).toContain(
        "an earlier deploy left migration 0001 without recording it as in progress; the next deploy runs it again from the start",
      );
    });
  });

  test("reports a checkpoint that fell behind before a rebaseline", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeRebaselineMarker(state.migrationsDir, "htailordb", {
      replacedHistoryId: "hprevious",
      replacedLatestMigration: 5,
    });
    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0003", "sdk-migration-history": "hprevious" },
      },
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.remoteSchema).toEqual({
      remoteMigrationNumber: 3,
      hasDrift: false,
      drifts: [],
      checkpointMissingLocal: true,
      rebaselinePending: { replacedLatestMigration: 5 },
      localLatestMigration: 0,
      historyIdMismatch: true,
    });
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
  });

  test("does not report rebaseline-pending when the checkpoint is already past the replaced migration", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeRebaselineMarker(state.migrationsDir, "htailordb", {
      replacedHistoryId: "hprevious",
      replacedLatestMigration: 5,
    });
    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0007", "sdk-migration-history": "hprevious" },
      },
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.remoteSchema).toEqual({
      remoteMigrationNumber: 7,
      hasDrift: false,
      drifts: [],
      checkpointMissingLocal: true,
      localLatestMigration: 0,
      historyIdMismatch: true,
    });
  });

  test.each([false, true])(
    "offers checkpoint recovery past the replaced migration only in the error (json=%s)",
    async (json) => {
      using _json = json ? jsonMode() : undefined;
      using stderr = captureStderr();
      writeRebaselineMarker(state.migrationsDir, "htailordb", {
        replacedHistoryId: "hprevious",
        replacedLatestMigration: 5,
      });
      state.getMetadata.mockResolvedValue({
        metadata: {
          labels: { "sdk-migration": "m0007", "sdk-migration-history": "hprevious" },
        },
      });

      const result = await runCommand(validateCommand, [
        "--config",
        "custom.config.ts",
        "--profile",
        "staging",
      ]);

      expect(result.success).toBe(false);
      expect(stderr.output).not.toContain("fell behind");
      expect(stderr.output).not.toContain("Pull the latest migration files");
      const { suggestion } = result.error as CLIError;
      expect(suggestion).toContain("Pull the latest migration files");
      expect(suggestion).toContain(
        "sync 0000 --force --namespace tailordb --config=custom.config.ts --workspace-id=12345678-1234-4abc-8def-123456789012 --profile=staging",
      );
      expect(suggestion).toContain("rewrites the tables");
      expect(suggestion).toContain("replaces the migration history ID");
    },
  );

  test("does not suggest checkpoint moves without a local migration", async () => {
    fs.rmSync(state.migrationsDir, { recursive: true });
    fs.mkdirSync(state.migrationsDir);
    state.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0007" } },
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const { suggestion } = result.error as CLIError;
    expect(suggestion).toContain("Pull the latest migration files");
    expect(suggestion).not.toContain("migration sync");
  });

  test("explains the rebaseline-pending recovery procedure for a checkpoint that fell behind", async () => {
    using stderr = captureStderr();
    writeRebaselineMarker(state.migrationsDir, "htailordb", {
      replacedHistoryId: "hprevious",
      replacedLatestMigration: 5,
    });
    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0003", "sdk-migration-history": "hprevious" },
      },
    });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain("fell behind before 'migration rebaseline' ran");
    expect(stderr.output).toContain("must reach 0005");
    expect(stderr.output).not.toContain("migration sync");
    expect(stderr.output).toContain(
      "Restore the pre-rebaseline migrations/ directory from git history",
    );
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

  test("reports a diff file in 0000 as misplaced rather than missing its script", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 0, [], { requiresMigrationScript: true });

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.migrationFiles.valid).toBe(false);
    expect(report.migrationFiles.error).toContain("Migration 0000 must not have diff.json");
    expect(report.migrationFiles.error).not.toMatch(/require a migration script/);
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
      "\n  `tailor tailordb migration script 0001 --namespace tailordb`\n",
    );
    expect(report.migrationFiles.error).toContain(
      "\n  `tailor tailordb migration script 0002 --namespace tailordb`\n",
    );
  });

  test("fails when a migration script still calls TODO", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(
      1,
      "migrate.ts",
      'import { TODO } from "./db";\nexport async function main() { TODO("fill email"); }',
    );

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.valid).toBe(false);
    expect(report.migrationFiles.valid).toBe(false);
    expect(report.migrationFiles.error).toContain("0001");
    expect(report.migrationFiles.error).toContain("TODO()");
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
  });

  test("fails when a migration script still has the review marker earlier versions generated", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(
      1,
      "migrate.ts",
      `// ${LEGACY_REVIEW_MARKER}\nexport async function main() {}`,
    );

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.migrationFiles.error).toContain("0001");
  });

  test("accepts a migration script once every TODO call is replaced", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(1, "migrate.ts", "export async function main() {}");

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.migrationFiles).toEqual({ valid: true });
  });

  test("fails when a multi-step migration script has an invalid step graph", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(
      1,
      "migrate.ts",
      'export const steps = { recompute: { dependsOn: ["backfill"], run: async () => {} } };',
    );

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(false);
    const [report] = JSON.parse(stdout.output);
    expect(report.migrationFiles.error).toContain('depends on undefined step "backfill"');
    expect(state.listTailorDBTypes).not.toHaveBeenCalled();
  });

  test("accepts a multi-step migration script", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(
      1,
      "migrate.ts",
      'export const steps = { backfill: { run: async () => {} }, recompute: { dependsOn: ["backfill"], run: async () => {} } };',
    );

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.migrationFiles).toEqual({ valid: true });
  });

  test("warns that steps is ignored when a script also exports main", async () => {
    using stderr = captureStderr();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(
      1,
      "migrate.ts",
      "export async function main() {}\nexport const steps = { backfill: { run: async () => {} } };",
    );

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    expect(stderr.output).toContain("migrate.ts exports `steps` next to `main`");
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

  test("ignores TODO placeholders outside migrate.ts", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(1, "migrate.ts", "export async function main() {}");
    writeMigrationFile(1, "db.ts", `// ${LEGACY_REVIEW_MARKER}`);

    const result = await runCommand(validateCommand, []);

    expect(result.success).toBe(true);
    const [report] = JSON.parse(stdout.output);
    expect(report.migrationFiles).toEqual({ valid: true });
  });

  test("fails when the remote migration state cannot be read", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();
    writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
    writeMigrationFile(1, "migrate.ts", "export async function main() {}");
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
    expect(bundleMigrationScript).not.toHaveBeenCalled();
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
    expect(String(result.error)).toMatch(/Duplicate TailorDB type name "User"/);
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

  test("--strict names a PowerShell and a cmd.exe hint for Windows-expandable config paths", async () => {
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
      `  \`tailor tailordb migration script '0001' --namespace tailordb '--config=%APPDATA%.config.ts' --no-script --reason '<reason>'\` in PowerShell or \`tailor tailordb migration script 0001 --namespace tailordb "--config=%%cd:~,%APPDATA%%cd:~,%.config.ts" --no-script --reason "<reason>"\` in cmd.exe`,
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

  describe("a migration an earlier deploy left in progress", () => {
    const STEPS_SCRIPT =
      'export const steps = { backfill: { run: async () => {} }, recompute: { dependsOn: ["backfill"], run: async () => {} } };';
    const EXECUTION_ID = "0190f3a2-7c1e-7d4b-9a6f-1b2c3d4e5f60";
    const EXECUTION_LABEL = "e0190f3a27c1e7d4b9a6f1b2c3d4e5f60";
    const STEP_RUNNER = "tailordb-migration--tailordb--0001--step";

    function writeStepsMigration(): void {
      writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
      writeMigrationFile(1, "migrate.ts", STEPS_SCRIPT);
    }

    function recordLabels(labels: Record<string, string>): void {
      state.getMetadata.mockResolvedValue({ metadata: { labels } });
    }

    function earlierRunWithFailedRecompute(): void {
      state.getWorkflowExecution.mockResolvedValue({
        execution: {
          id: EXECUTION_ID,
          status: WorkflowExecution_Status.FAILED,
          jobExecutions: ["backfill", "recompute"].map((step, callIndex) => ({
            executionId: `fn-${step}`,
            status:
              step === "backfill"
                ? WorkflowJobExecution_Status.SUCCESS
                : WorkflowJobExecution_Status.FAILED,
            position: { callIndex, depth: 1 },
            kind: { case: "jobFunction", value: { name: STEP_RUNNER } },
          })),
        },
      });
      state.getFunctionExecution.mockImplementation(
        async ({ executionId }: { executionId: string }) => ({
          execution: { result: JSON.stringify({ step: executionId.slice("fn-".length) }) },
        }),
      );
    }

    test("reports a record that names a migration other than the next pending one", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeStepsMigration();
      recordLabels({ "sdk-migration": "m0000", "sdk-migration-in-progress": "m0002" });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      expect(String(result.error)).toMatch(/Migration validation failed for 1 namespace/);
      const [report] = JSON.parse(stdout.output);
      expect(report.valid).toBe(false);
      expect(report.migrationInProgress).toEqual({
        valid: false,
        migrationNumber: 2,
        error: expect.objectContaining({
          code: "MIGRATION_IN_PROGRESS_INVALID",
          message:
            "Migration tailordb/0002 is in progress, but the next pending migration is 0001.",
        }),
      });
    });

    test("reports a record past the local migration history", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeStepsMigration();
      recordLabels({ "sdk-migration": "m0001", "sdk-migration-in-progress": "m0002" });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      const [report] = JSON.parse(stdout.output);
      expect(report.migrationInProgress.error).toMatchObject({
        code: "MIGRATION_IN_PROGRESS_INVALID",
        message: "Migration tailordb/0002 is in progress, but the next pending migration is none.",
      });
    });

    test("reports a partially applied migration whose script no longer exports steps", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
      writeMigrationFile(1, "migrate.ts", "export async function main() {}");
      recordLabels({ "sdk-migration": "m0000", "sdk-migration-in-progress": "m0001" });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      const [report] = JSON.parse(stdout.output);
      expect(report.migrationInProgress.error).toMatchObject({
        code: "MIGRATION_IN_PROGRESS_INVALID",
        message:
          "Migration tailordb/0001 was partially applied by its steps, but its migrate.ts no longer exports `steps`.",
      });
      expect(report).not.toHaveProperty("pendingMigrationScripts");
      expect(bundleMigrationScript).not.toHaveBeenCalled();
    });

    test("reports an in-progress record it cannot read", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeStepsMigration();
      recordLabels({ "sdk-migration": "m0000", "sdk-migration-in-progress": "not-a-migration" });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      const [report] = JSON.parse(stdout.output);
      expect(report.migrationInProgress).toEqual({
        valid: false,
        error: expect.objectContaining({ code: "MIGRATION_IN_PROGRESS_INVALID" }),
      });
    });

    test("reports a `main` run whose outcome an earlier deploy did not settle", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
      writeMigrationFile(1, "migrate.ts", "export async function main() {}");
      recordLabels({
        "sdk-migration": "m0000",
        "sdk-migration-in-progress": "m0001-main",
        "sdk-migration-execution": EXECUTION_LABEL,
      });
      state.getWorkflowExecution.mockResolvedValue({
        execution: { id: EXECUTION_ID, status: WorkflowExecution_Status.FAILED, jobExecutions: [] },
      });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      const [report] = JSON.parse(stdout.output);
      expect(report.migrationInProgress.error).toMatchObject({
        code: "MIGRATION_OUTCOME_UNSETTLED",
        message: expect.stringContaining("its run failed"),
        next: {
          command: "tailor",
          args: expect.arrayContaining(["resolve", "--rollback", "--namespace", "tailordb"]),
        },
      });
    });

    test.each([
      { record: "a readable record", inProgressLabel: "m0006" },
      { record: "a record it cannot read", inProgressLabel: "not-a-migration" },
    ])(
      "reports $record in a namespace whose checkpoint the next deploy would reset",
      async ({ inProgressLabel }) => {
        using stdout = captureStdout();
        using _json = jsonMode();
        writeRebaselineMarker(state.migrationsDir, "htailordb", { replacedLatestMigration: 5 });
        recordLabels({ "sdk-migration": "m0005", "sdk-migration-in-progress": inProgressLabel });

        const result = await runCommand(validateCommand, []);

        expect(result.success).toBe(false);
        const [report] = JSON.parse(stdout.output);
        expect(report.migrationInProgress.error).toMatchObject({
          code: "MIGRATION_IN_PROGRESS_CONFLICT",
        });
      },
    );

    test("leaves the record to the checkpoint check when the checkpoint is not in the local history", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      recordLabels({ "sdk-migration": "m0005", "sdk-migration-in-progress": "m0006" });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      const [report] = JSON.parse(stdout.output);
      expect(report.remoteSchema.checkpointMissingLocal).toBe(true);
      expect(report).not.toHaveProperty("migrationInProgress");
    });

    test("accepts a multi-step migration the next deploy resumes", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeStepsMigration();
      recordLabels({ "sdk-migration": "m0000", "sdk-migration-in-progress": "m0001" });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(true);
      const [report] = JSON.parse(stdout.output);
      expect(report.valid).toBe(true);
      expect(report.migrationInProgress).toEqual({ valid: true, migrationNumber: 1 });
    });

    test("ignores a record of a migration the checkpoint already covers", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeStepsMigration();
      recordLabels({ "sdk-migration": "m0001", "sdk-migration-in-progress": "m0001" });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(true);
      const [report] = JSON.parse(stdout.output);
      expect(report).not.toHaveProperty("migrationInProgress");
      expect(report).not.toHaveProperty("pendingMigrationScripts");
      expect(bundleMigrationSteps).not.toHaveBeenCalled();
    });

    test("shows the migration the next deploy resumes", async () => {
      using stderr = captureStderr();
      writeStepsMigration();
      recordLabels({ "sdk-migration": "m0000", "sdk-migration-in-progress": "m0001" });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(true);
      expect(stderr.output).toContain("Migration in progress: OK (the next deploy resumes 0001)");
    });

    test("shows why the next deploy cannot resume the migration and what to do", async () => {
      using stderr = captureStderr();
      writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
      writeMigrationFile(1, "migrate.ts", "export async function main() {}");
      recordLabels({ "sdk-migration": "m0000", "sdk-migration-in-progress": "m0001" });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      expect(stderr.output).toContain(
        "Migration in progress: Migration tailordb/0001 was partially applied by its steps, but its migrate.ts no longer exports `steps`.",
      );
      expect(stderr.output).toContain(
        "Keep the migration as `steps` so the deploy can finish it; steps that already completed do not run again unless you add, remove, or rename a step, change the order the steps run in, or the earlier run was canceled or is no longer available.",
      );
    });

    describe("--migration-skip-steps", () => {
      beforeEach(() => {
        writeStepsMigration();
        recordLabels({
          "sdk-migration": "m0000",
          "sdk-migration-in-progress": "m0001",
          "sdk-migration-execution": EXECUTION_LABEL,
        });
        earlierRunWithFailedRecompute();
      });

      test("accepts a step that succeeded in the earlier run", async () => {
        using stdout = captureStdout();
        using _json = jsonMode();

        const result = await runCommand(validateCommand, [
          "--migration-skip-steps",
          "tailordb/backfill",
        ]);

        expect(result.success).toBe(true);
        const [report] = JSON.parse(stdout.output);
        expect(report.migrationInProgress).toEqual({ valid: true, migrationNumber: 1 });
        expect(report.pendingMigrationScripts).toEqual({
          valid: true,
          migrationNumbers: [1],
          machineUser: "admin",
        });
      });

      test("reports a step that did not succeed in the earlier run", async () => {
        using stdout = captureStdout();
        using _json = jsonMode();

        const result = await runCommand(validateCommand, [
          "--migration-skip-steps",
          "tailordb/recompute",
        ]);

        expect(result.success).toBe(false);
        const [report] = JSON.parse(stdout.output);
        expect(report.migrationInProgress).toEqual({ valid: true, migrationNumber: 1 });
        expect(report.pendingMigrationScripts).toEqual({
          valid: false,
          migrationNumbers: [1],
          error: expect.objectContaining({
            code: "MIGRATION_SKIP_STEPS_INVALID",
            message: expect.stringContaining("'recompute' did not succeed in the earlier run"),
          }),
        });
      });

      test("reports steps to skip in a namespace with nothing in progress", async () => {
        using stdout = captureStdout();
        using _json = jsonMode();
        recordLabels({ "sdk-migration": "m0000" });

        const result = await runCommand(validateCommand, [
          "--migration-skip-steps",
          "tailordb/backfill",
        ]);

        expect(result.success).toBe(false);
        const [report] = JSON.parse(stdout.output);
        expect(report).not.toHaveProperty("migrationInProgress");
        expect(report.pendingMigrationScripts).toEqual({
          valid: false,
          migrationNumbers: [1],
          error: expect.objectContaining({
            code: "MIGRATION_SKIP_STEPS_INVALID",
            message: expect.stringContaining("no multi-step migration of it is partially applied"),
          }),
        });
      });

      test("reports steps to skip in a namespace with no pending migration", async () => {
        using stdout = captureStdout();
        using _json = jsonMode();
        recordLabels({ "sdk-migration": "m0001" });

        const result = await runCommand(validateCommand, [
          "--migration-skip-steps",
          "tailordb/backfill",
        ]);

        expect(result.success).toBe(false);
        const [report] = JSON.parse(stdout.output);
        expect(report.pendingMigrationScripts).toEqual({
          valid: false,
          migrationNumbers: [],
          error: expect.objectContaining({ code: "MIGRATION_SKIP_STEPS_INVALID" }),
        });
      });

      test("keeps the other checks when the earlier run cannot be read", async () => {
        using stdout = captureStdout();
        using _json = jsonMode();
        state.getWorkflowExecution.mockRejectedValue(new ConnectError("boom", Code.Internal));

        const result = await runCommand(validateCommand, [
          "--migration-skip-steps",
          "tailordb/backfill",
        ]);

        expect(result.success).toBe(false);
        expect(String(result.error)).toMatch(/boom/);
        const [report] = JSON.parse(stdout.output);
        expect(report.remoteSchema).toEqual({
          remoteMigrationNumber: 0,
          hasDrift: false,
          drifts: [],
        });
        expect(report.migrationInProgress).toEqual({ valid: true, migrationNumber: 1 });
        expect(report.pendingMigrationScripts).toEqual({
          valid: false,
          migrationNumbers: [1],
          skipped: "check_failed",
        });
      });

      test("shows a check that could not run as not checked", async () => {
        using stderr = captureStderr();
        state.getWorkflowExecution.mockRejectedValue(new ConnectError("boom", Code.Internal));

        const result = await runCommand(validateCommand, [
          "--migration-skip-steps",
          "tailordb/backfill",
        ]);

        expect(result.success).toBe(false);
        expect(stderr.output).toContain("Remote schema: OK (remote migration: 0000)");
        expect(stderr.output).toContain("Pending migration scripts: not checked");
      });

      test("rejects an entry that is not <namespace>/<step>", async () => {
        const result = await runCommand(validateCommand, ["--migration-skip-steps", "backfill"]);

        expect(result.success).toBe(false);
        expect((result.error as CLIError).code).toBe("MIGRATION_SKIP_STEPS_FORMAT_INVALID");
      });

      test("rejects a namespace the config does not define", async () => {
        const result = await runCommand(validateCommand, [
          "--migration-skip-steps",
          "other/backfill",
        ]);

        expect(result.success).toBe(false);
        expect(result.error).toMatchObject({
          code: "MIGRATION_SKIP_STEPS_INVALID",
          message:
            "Cannot check the steps to skip in namespace 'other': the config defines no TailorDB namespace with that name.",
          suggestion: expect.stringContaining(
            "Use one of the config's TailorDB namespaces: tailordb.",
          ),
          context: { namespace: "other", requested: ["backfill"], namespaces: ["tailordb"] },
        });
        expect(state.getMetadata).not.toHaveBeenCalled();
      });

      test("rejects a namespace without migrations", async () => {
        state.extraServices = [
          {
            namespace: "audit",
            config: {},
            typeSourceInfo: {},
            loadTypes: vi.fn().mockResolvedValue(undefined),
            processNamespacePlugins: vi.fn().mockResolvedValue(undefined),
            types: {},
          },
        ];

        const result = await runCommand(validateCommand, [
          "--migration-skip-steps",
          "audit/backfill",
        ]);

        expect(result.success).toBe(false);
        expect(result.error).toMatchObject({
          code: "MIGRATION_SKIP_STEPS_INVALID",
          message: expect.stringContaining("no multi-step migration of it is partially applied"),
        });
      });

      test("rejects a namespace that --namespace leaves out", async () => {
        const auditMigrationsDir = path.join(tmpDir, "audit-migrations");
        writeInitialSchema(auditMigrationsDir, {});
        vi.mocked(loadConfig).mockResolvedValue({
          config: {
            path: path.join(tmpDir, "tailor.config.ts"),
            db: {
              tailordb: { migration: { directory: state.migrationsDir } },
              audit: { migration: { directory: auditMigrationsDir } },
            },
          },
          plugins: [],
        } as unknown as Awaited<ReturnType<typeof loadConfig>>);
        state.extraServices = [
          {
            namespace: "audit",
            config: {},
            typeSourceInfo: {},
            loadTypes: vi.fn().mockResolvedValue(undefined),
            processNamespacePlugins: vi.fn().mockResolvedValue(undefined),
            types: {},
          },
        ];

        const result = await runCommand(validateCommand, [
          "--namespace",
          "tailordb",
          "--migration-skip-steps",
          "audit/backfill",
        ]);

        expect(result.success).toBe(false);
        expect(result.error).toMatchObject({
          code: "MIGRATION_VALIDATE_OPTIONS_CONFLICT",
          context: { namespace: "audit", requested: ["backfill"] },
        });
      });
    });
  });

  describe("pending migration scripts", () => {
    function writeMainMigration(migrationNumber: number): void {
      writeDiff(state.migrationsDir, migrationNumber, [], { requiresMigrationScript: true });
      writeMigrationFile(migrationNumber, "migrate.ts", "export async function main() {}");
    }

    test("reports the pending scripts and the machine user that runs them", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeMainMigration(1);

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(true);
      const [report] = JSON.parse(stdout.output);
      expect(report).toMatchObject({
        valid: true,
        pendingMigrationScripts: { valid: true, migrationNumbers: [1], machineUser: "admin" },
      });
      expect(bundleMigrationScript).toHaveBeenCalledWith(
        path.join(state.migrationsDir, "0001", "migrate.ts"),
        "tailordb",
        1,
        {},
        tmpDir,
        false,
        "legacy",
      );
    });

    test("shows the pending scripts and the machine user that runs them", async () => {
      using stderr = captureStderr();
      writeMainMigration(1);
      writeMainMigration(2);

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(true);
      expect(stderr.output).toContain("Pending migration scripts: OK (0001, 0002 run as 'admin')");
    });

    test.each([
      {
        case: "no auth",
        authService: undefined,
        machineUser: undefined,
        code: "AUTH_CONFIG_REQUIRED",
      },
      {
        case: "an auth without machine users",
        authService: { config: { name: "auth", machineUsers: {} } },
        machineUser: undefined,
        code: "MACHINE_USER_REQUIRED",
      },
      {
        case: "a machine user the auth does not define",
        authService: { config: { name: "auth", machineUsers: { admin: {} } } },
        machineUser: "nobody",
        code: "MACHINE_USER_NOT_FOUND",
      },
    ])("reports a pending script that cannot run with $case", async (row) => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeMainMigration(1);
      state.authService = row.authService;
      mockConfig({ machineUser: row.machineUser });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      expect(String(result.error)).toMatch(/Migration validation failed for 1 namespace/);
      const [report] = JSON.parse(stdout.output);
      expect(report).toMatchObject({
        valid: false,
        pendingMigrationScripts: {
          valid: false,
          migrationNumbers: [1],
          error: { code: row.code },
        },
      });
      expect(bundleMigrationScript).not.toHaveBeenCalled();
    });

    test("reports a pending script that cannot be bundled", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeMainMigration(1);
      vi.mocked(bundleMigrationScript).mockRejectedValue(
        new Error('Could not resolve "./missing"'),
      );

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      const [report] = JSON.parse(stdout.output);
      expect(report).toMatchObject({
        valid: false,
        pendingMigrationScripts: {
          valid: false,
          migrationNumbers: [1],
          error: {
            code: "MIGRATION_SCRIPT_BUNDLE_FAILED",
            message: 'Could not resolve "./missing"',
          },
        },
      });
    });

    test("reports a bundler error without its colors, as deploy does", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeMainMigration(1);
      vi.mocked(bundleMigrationScript).mockRejectedValue(
        new Error("Build failed:\n\u001b[31m[UNRESOLVED_IMPORT]\u001b[0m Could not resolve"),
      );

      await runCommand(validateCommand, []);

      const [report] = JSON.parse(stdout.output);
      expect(report.pendingMigrationScripts.error.message).toBe(
        "Build failed:\n[UNRESOLVED_IMPORT] Could not resolve",
      );
    });

    test("indents the lines of a multi-line error under its section", async () => {
      using stderr = captureStderr();
      writeMainMigration(1);
      vi.mocked(bundleMigrationScript).mockRejectedValue(
        new Error("Build failed:\n[UNRESOLVED_IMPORT] Could not resolve"),
      );

      await runCommand(validateCommand, []);

      expect(stderr.output).toContain(
        "  Pending migration scripts: Build failed:\n    [UNRESOLVED_IMPORT] Could not resolve",
      );
    });

    test("shows why a pending script cannot run and what to do", async () => {
      using stderr = captureStderr();
      writeMainMigration(1);
      state.authService = undefined;

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      expect(stderr.output).toContain(
        "Pending migration scripts: Auth configuration is required to execute migration scripts.",
      );
      expect(stderr.output).toContain(
        "Define auth with machine users in this config; migration scripts run as one of them.",
      );
    });

    test("bundles a resumed multi-step migration with the step runner", async () => {
      using _stdout = captureStdout();
      using _json = jsonMode();
      writeDiff(state.migrationsDir, 1, [], { requiresMigrationScript: true });
      writeMigrationFile(
        1,
        "migrate.ts",
        "export const steps = { backfill: { run: async () => {} } };",
      );
      state.getMetadata.mockResolvedValue({
        metadata: { labels: { "sdk-migration": "m0000", "sdk-migration-in-progress": "m0001" } },
      });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(true);
      expect(bundleMigrationSteps).toHaveBeenCalledOnce();
      expect(bundleSingleStepMigration).not.toHaveBeenCalled();
    });

    test("treats every migration as pending in a namespace whose checkpoint the next deploy resets", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeRebaselineMarker(state.migrationsDir, "htailordb", { replacedLatestMigration: 5 });
      writeMainMigration(1);
      state.getMetadata.mockResolvedValue({ metadata: { labels: { "sdk-migration": "m0005" } } });

      const result = await runCommand(validateCommand, []);

      const [report] = JSON.parse(stdout.output);
      expect(report.remoteSchema.checkpointRepair).toMatchObject({ from: 5, to: 0 });
      expect(report.pendingMigrationScripts).toEqual({
        valid: true,
        migrationNumbers: [1],
        machineUser: "admin",
      });
      expect(result.success).toBe(true);
    });

    test("leaves the scripts to the checkpoint check when the checkpoint is not in the local history", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();
      writeMainMigration(1);
      state.getMetadata.mockResolvedValue({ metadata: { labels: { "sdk-migration": "m0005" } } });

      const result = await runCommand(validateCommand, []);

      expect(result.success).toBe(false);
      const [report] = JSON.parse(stdout.output);
      expect(report.remoteSchema.checkpointMissingLocal).toBe(true);
      expect(report).not.toHaveProperty("pendingMigrationScripts");
      expect(bundleMigrationScript).not.toHaveBeenCalled();
    });
  });
});
