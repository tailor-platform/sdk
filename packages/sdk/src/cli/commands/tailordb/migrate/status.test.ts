import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfigFile } from "#/cli/shared/config-loader";
import { loadAccessToken } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import { statusCommand } from "./status";
import { migrationDbConfig } from "./test-helpers/migration-config";
import {
  writeDiff,
  writeInitialSchema,
  writeRebaselineMarker,
} from "./test-helpers/schema-fixtures";

const state = vi.hoisted(() => ({
  migrationsDir: "",
}));

const client = mockOperatorClient({ getMetadata: {} });

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfigFile: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

const workspaceArg = "--workspace-id=12345678-1234-4abc-8def-123456789012";

describe("tailordb migration status --json", () => {
  aroundEach(async (runTest) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-status-json-test-"));
    state.migrationsDir = path.join(tmpDir, "migrations");
    vi.mocked(loadAccessToken).mockReset().mockResolvedValue("mock-token");
    vi.mocked(initOperatorClient).mockReset();
    writeInitialSchema(state.migrationsDir, {});
    writeDiff(state.migrationsDir, 1, [], { description: "Add users" });
    writeDiff(state.migrationsDir, 2, [], { description: "Add orders" });

    vi.mocked(loadConfigFile).mockResolvedValue({
      kind: "config",
      config: {
        path: path.join(tmpDir, "tailor.config.ts"),
        db: {
          tailordb: {
            migration: {
              directory: state.migrationsDir,
            },
          },
        },
      },
    } as unknown as Awaited<ReturnType<typeof loadConfigFile>>);

    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: {
          "sdk-migration": "m0001",
        },
      },
    });
    vi.mocked(initOperatorClient).mockResolvedValue(client);

    await runTest();

    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits a parseable JSON array of namespace migration statuses", async () => {
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([
      {
        status: "ok",
        namespace: "tailordb",
        currentMigration: 1,
        currentMigrationLabel: "0001",
        pendingMigrations: [
          {
            number: 2,
            label: "0002",
            description: "Add orders",
          },
        ],
      },
    ]);
  });

  test("reports a migration left in progress by an earlier deploy", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-in-progress": "m0002" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        inProgressMigration: 2,
        inProgressMigrationLabel: "0002",
        inProgressMigrationRun: "steps",
        inProgressMigrationActions: [
          { action: "resume", command: "tailor", args: ["deploy", workspaceArg] },
          {
            action: "rollback",
            command: "tailor",
            args: [
              "tailordb",
              "migration",
              "resolve",
              "--rollback",
              "--namespace",
              "tailordb",
              workspaceArg,
            ],
          },
          {
            action: "complete",
            command: "tailor",
            args: [
              "tailordb",
              "migration",
              "resolve",
              "--complete",
              "--namespace",
              "tailordb",
              workspaceArg,
            ],
          },
        ],
      },
    ]);
  });

  test("reports tables a deploy left in maintenance mode at the checkpoint and the command that releases them", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-maintenance-mode": "m0001" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        maintenanceModeCheckpoint: 1,
        maintenanceModeCheckpointLabel: "0001",
        maintenanceModeRelease: {
          command: "tailor",
          args: [
            "tailordb",
            "migration",
            "resolve",
            "--maintenance",
            "--namespace",
            "tailordb",
            workspaceArg,
          ],
        },
      },
    ]);
  });

  test("lists deploy for a maintenance record while a removed table of the committed migration is not deleted yet", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: {
          "sdk-migration": "m0001",
          "sdk-maintenance-mode": "m0001",
          "sdk-migration-cleanup": "m0001",
        },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    const [row] = JSON.parse(stdout.output) as Record<string, unknown>[];
    expect(row).toMatchObject({
      maintenanceModeCheckpoint: 1,
      maintenanceModeRelease: { via: "deploy", command: "tailor", args: ["deploy", workspaceArg] },
    });
    expect((row?.maintenanceModeRelease as Record<string, unknown>).fallback).toBeUndefined();
  });

  test("tells a deploy removes a maintenance mode record that names another checkpoint, and sync when the deploy stops on drift", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-maintenance-mode": "m0002" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        maintenanceModeCheckpoint: 2,
        maintenanceModeCheckpointLabel: "0002",
        maintenanceModeRelease: {
          via: "deploy",
          command: "tailor",
          args: ["deploy", workspaceArg],
          fallback: {
            command: "tailor",
            args: [
              "tailordb",
              "migration",
              "sync",
              "0001",
              "--namespace",
              "tailordb",
              workspaceArg,
            ],
          },
        },
      },
    ]);
  });

  test.each([
    [
      "comes with a migration in progress",
      {
        "sdk-migration": "m0001",
        "sdk-migration-in-progress": "m0002",
        "sdk-maintenance-mode": "m0001",
      },
    ],
    ["is absent", { "sdk-migration": "m0001" }],
  ])("does not offer to release maintenance mode when the record %s", async (_name, labels) => {
    client.getMetadata.mockResolvedValue({ metadata: { labels } });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    const [row] = JSON.parse(stdout.output) as Record<string, unknown>[];
    expect(row).not.toHaveProperty("maintenanceModeRelease");
  });

  test("reports a `main` run whose outcome an earlier deploy could not settle", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-in-progress": "m0002-main" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    const [row] = JSON.parse(stdout.output) as Record<string, unknown>[];
    expect(row).toMatchObject({
      status: "ok",
      inProgressMigration: 2,
      inProgressMigrationRun: "main",
    });
    expect(row?.inProgressMigrationActions).toEqual([
      expect.objectContaining({
        action: "complete",
        args: [
          "tailordb",
          "migration",
          "resolve",
          "--complete",
          "--namespace",
          "tailordb",
          workspaceArg,
        ],
      }),
      expect.objectContaining({
        action: "rollback",
        args: [
          "tailordb",
          "migration",
          "resolve",
          "--rollback",
          "--namespace",
          "tailordb",
          workspaceArg,
        ],
      }),
    ]);
  });

  test.each<{ name: string; labels: Record<string, string>; actions: string[] }>([
    {
      name: "a namespace without a checkpoint",
      labels: { "sdk-migration-in-progress": "m0001" },
      actions: ["resume", "rollback", "complete"],
    },
    {
      name: "a record ahead of the migration after the checkpoint",
      labels: { "sdk-migration": "m0000", "sdk-migration-in-progress": "m0002" },
      actions: [],
    },
  ])("lists the in-progress commands that accept $name", async (row) => {
    client.getMetadata.mockResolvedValue({ metadata: { labels: row.labels } });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    const [status] = JSON.parse(stdout.output) as {
      inProgressMigrationActions: { action: string }[];
    }[];
    expect(status?.inProgressMigrationActions.map(({ action }) => action)).toEqual(row.actions);
  });

  test("keeps the config, workspace, and profile of the run in the in-progress commands", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-in-progress": "m0002" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, ["--config", "apps/tailor.config.ts", "--profile", "staging"]);

    const [row] = JSON.parse(stdout.output) as {
      inProgressMigrationActions: { args: string[] }[];
    }[];
    const context = ["--config=apps/tailor.config.ts", workspaceArg, "--profile=staging"];
    expect(row?.inProgressMigrationActions.map(({ args }) => args)).toEqual([
      ["deploy", ...context],
      ["tailordb", "migration", "resolve", "--rollback", "--namespace", "tailordb", ...context],
      ["tailordb", "migration", "resolve", "--complete", "--namespace", "tailordb", ...context],
    ]);
  });

  test("tells the user to settle a `main` run whose outcome is not settled", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-in-progress": "m0002-main" },
      },
    });
    using stderr = captureStderr();

    await runCommand(statusCommand, []);

    expect(stderr.output).toContain("In progress: 0002");
    expect(stderr.output).toContain(
      `Complete: \`tailor tailordb migration resolve --complete --namespace tailordb ${workspaceArg}\``,
    );
    expect(stderr.output).toContain(
      `Roll back: \`tailor tailordb migration resolve --rollback --namespace tailordb ${workspaceArg}\``,
    );
    expect(stderr.output).not.toContain("tailor deploy");
  });

  test("does not report an in-progress record the checkpoint already passed", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0002", "sdk-migration-in-progress": "m0002" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    const [row] = JSON.parse(stdout.output) as Record<string, unknown>[];
    expect(row).toMatchObject({ status: "ok", currentMigration: 2 });
    expect(row).not.toHaveProperty("inProgressMigration");
    expect(row).not.toHaveProperty("inProgressMigrationActions");
  });

  test("tells the user how to resume, roll back, or complete an in-progress migration", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-in-progress": "m0002" },
      },
    });
    using stderr = captureStderr();

    await runCommand(statusCommand, []);

    expect(stderr.output).toContain("In progress: 0002");
    expect(stderr.output).toContain(`Resume: \`tailor deploy ${workspaceArg}\``);
    expect(stderr.output).toContain(
      `Roll back: \`tailor tailordb migration resolve --rollback --namespace tailordb ${workspaceArg}\``,
    );
    expect(stderr.output).toContain(
      `Complete: \`tailor tailordb migration resolve --complete --namespace tailordb ${workspaceArg}\``,
    );
  });

  test("reports unreadable in-progress labels as an error", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-in-progress": "broken" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      { status: "error", error: expect.stringContaining("in-progress") },
    ]);
  });

  test("treats metadata NotFound as no applied migrations", async () => {
    client.getMetadata.mockRejectedValue(new ConnectError("metadata not found", Code.NotFound));
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        namespace: "tailordb",
        currentMigration: 0,
        pendingMigrations: [{ number: 1 }, { number: 2 }],
      },
    ]);
  });

  test("propagates metadata errors other than NotFound", async () => {
    client.getMetadata.mockRejectedValue(new ConnectError("unavailable", Code.Unavailable));
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/Migration status check failed for 1 namespace: tailordb/);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringContaining("unavailable"),
      },
    ]);
  });

  test("reports unsupported pending migration file versions", async () => {
    fs.writeFileSync(
      path.join(state.migrationsDir, "0002", "diff.json"),
      JSON.stringify({ version: SCHEMA_SNAPSHOT_VERSION + 1 }),
    );
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringContaining(
          `This SDK supports migration file format versions 1-${SCHEMA_SNAPSHOT_VERSION}`,
        ),
      },
    ]);
  });

  test("reports unsupported local versions before loading credentials", async () => {
    fs.writeFileSync(
      path.join(state.migrationsDir, "0002", "diff.json"),
      JSON.stringify({ version: SCHEMA_SNAPSHOT_VERSION + 1 }),
    );
    vi.mocked(loadAccessToken).mockRejectedValueOnce(new Error("authentication unavailable"));
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringContaining(
          `This SDK supports migration file format versions 1-${SCHEMA_SNAPSHOT_VERSION}`,
        ),
      },
    ]);
    expect(loadAccessToken).not.toHaveBeenCalled();
    expect(initOperatorClient).not.toHaveBeenCalled();
  });

  test("reports a migration directory that has migrate.ts but no diff.json", async () => {
    fs.mkdirSync(path.join(state.migrationsDir, "0003"));
    fs.writeFileSync(path.join(state.migrationsDir, "0003", "migrate.ts"), "export {};");
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringContaining("Migration 0003 has migrate.ts but no diff.json"),
      },
    ]);
  });

  test.each([
    ["baseline", "0000/schema.json"],
    ["applied diff", "0001/diff.json"],
  ])("reports unsupported versions in the %s", async (_description, relativePath) => {
    const filePath = path.join(state.migrationsDir, relativePath);
    const contents = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    fs.writeFileSync(
      filePath,
      JSON.stringify({ ...contents, version: SCHEMA_SNAPSHOT_VERSION + 1 }),
    );
    client.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0002" } },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringContaining(
          `This SDK supports migration file format versions 1-${SCHEMA_SNAPSHOT_VERSION}`,
        ),
      },
    ]);
  });

  test("reports a remote migration history mismatch", async () => {
    writeRebaselineMarker(state.migrationsDir, "hlocal");
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-history": "hremote" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringMatching(/remote migration history .*hremote.*local.*hlocal/i),
      },
    ]);
  });

  test("reports a remote checkpoint ahead of the local migration history as an error", async () => {
    client.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0009" } },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, [
      "--config",
      "custom.config.ts",
      "--profile",
      "staging",
    ]);

    expect(result.success).toBe(false);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "error",
        namespace: "tailordb",
        error: expect.stringMatching(/checkpoint 0009.*ahead.*latest local migration 0002/i),
      },
    ]);
    const [{ error }] = JSON.parse(stdout.output);
    const context = `--config=custom.config.ts ${workspaceArg} --profile=staging`;
    expect(error).toContain(`sync 0002 --namespace tailordb ${context}`);
    expect(error).toContain(
      "Each command rewrites the tables to that migration, removing the fields it does not have and deleting the tables it does not have together with their data",
    );
    expect(error).not.toContain("--force");
  });

  test.each([
    { history: "another migration history ID", label: "hremote" },
    { history: "a migration history label it cannot read", label: "Not a history ID" },
  ])("offers to replace $history with --force", async ({ label }) => {
    writeRebaselineMarker(state.migrationsDir, "hlocal");
    client.getMetadata.mockResolvedValue({
      metadata: { labels: { "sdk-migration": "m0001", "sdk-migration-history": label } },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    const [{ error }] = JSON.parse(stdout.output);
    expect(error).toContain("Pull the latest migration files");
    expect(error).toContain("sync 0002 --force --namespace tailordb");
    expect(error).toContain("replaces the migration history ID");
  });

  test.each<{
    name: string;
    checkpoint: number;
    label: string;
    replacedHistoryId: string | null;
    labels: Record<string, string>;
  }>([
    {
      name: "the checkpoint of the migration history the baseline replaced",
      checkpoint: 5,
      label: "0005",
      replacedHistoryId: "hprevious",
      labels: { "sdk-migration": "m0005", "sdk-migration-history": "hprevious" },
    },
    {
      name: "a checkpoint 0000 of the migration history the baseline replaced",
      checkpoint: 0,
      label: "0000",
      replacedHistoryId: "hprevious",
      labels: { "sdk-migration": "m0000", "sdk-migration-history": "hprevious" },
    },
    {
      name: "the checkpoint a first rebaseline replaced",
      checkpoint: 5,
      label: "0005",
      replacedHistoryId: null,
      labels: { "sdk-migration": "m0005" },
    },
  ])(
    "reports the reset the next deploy makes to $name, with the migrations after 0000 as pending",
    async ({ checkpoint, label, replacedHistoryId, labels }) => {
      writeRebaselineMarker(state.migrationsDir, "hlocal", {
        replacedHistoryId,
        replacedLatestMigration: checkpoint,
      });
      client.getMetadata.mockResolvedValue({ metadata: { labels } });
      using stdout = captureStdout();
      using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      using _json = jsonMode();

      const result = await runCommand(statusCommand, []);

      expect(result.success).toBe(true);
      expect(JSON.parse(stdout.output)).toEqual([
        {
          status: "ok",
          namespace: "tailordb",
          currentMigration: checkpoint,
          currentMigrationLabel: label,
          checkpointRepair: {
            from: checkpoint,
            to: 0,
            fromHistoryId: replacedHistoryId,
            toHistoryId: "hlocal",
          },
          pendingMigrations: [
            { number: 1, label: "0001", description: "Add users" },
            { number: 2, label: "0002", description: "Add orders" },
          ],
        },
      ]);
    },
  );

  test.each<{
    replacedHistoryId: string | null;
    labels: Record<string, string>;
    historyChange: string;
  }>([
    {
      replacedHistoryId: "hprevious",
      labels: { "sdk-migration": "m0005", "sdk-migration-history": "hprevious" },
      historyChange: "hprevious → hlocal",
    },
    {
      replacedHistoryId: null,
      labels: { "sdk-migration": "m0005" },
      historyChange: "<unset> → hlocal",
    },
  ])(
    "tells that the next deploy checks the schema before resetting the checkpoint and the migration history ID $historyChange",
    async ({ replacedHistoryId, labels, historyChange }) => {
      writeRebaselineMarker(state.migrationsDir, "hlocal", {
        replacedHistoryId,
        replacedLatestMigration: 5,
      });
      client.getMetadata.mockResolvedValue({ metadata: { labels } });
      using stderr = captureStderr();

      const result = await runCommand(statusCommand, []);

      expect(result.success).toBe(true);
      expect(stderr.output).toContain("Current migration: 0005");
      expect(stderr.output).toContain(
        `Checkpoint reset: the next deploy checks that the remote schema matches 0000, then asks to reset the checkpoint 0005 → 0000 and the migration history ID ${historyChange}`,
      );
      expect(stderr.output).toContain("- 0001: Add users");
    },
  );

  test.each([
    {
      record: "a migration in progress",
      inProgress: "m0006",
      error:
        'A migration is in progress in namespace "tailordb", so its checkpoint cannot be repaired.',
    },
    {
      record: "an in-progress record the checkpoint already passed",
      inProgress: "m0005",
      error:
        'A migration is in progress in namespace "tailordb", so its checkpoint cannot be repaired.',
    },
    {
      record: "an in-progress record it cannot read",
      inProgress: "broken",
      error:
        'The in-progress migration recorded for namespace "tailordb" cannot be read.\nThe namespace metadata was edited outside the SDK. Restore the in-progress labels it recorded before deploying again.',
    },
  ])(
    "reports the error the next deploy stops with for $record at a checkpoint it would reset",
    async ({ inProgress, error }) => {
      writeRebaselineMarker(state.migrationsDir, "hlocal", {
        replacedHistoryId: "hprevious",
        replacedLatestMigration: 5,
      });
      client.getMetadata.mockResolvedValue({
        metadata: {
          labels: {
            "sdk-migration": "m0005",
            "sdk-migration-history": "hprevious",
            "sdk-migration-in-progress": inProgress,
          },
        },
      });
      using stdout = captureStdout();
      using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      using _json = jsonMode();

      const result = await runCommand(statusCommand, []);

      expect(result.success).toBe(false);
      expect(JSON.parse(stdout.output)).toEqual([
        { status: "error", namespace: "tailordb", error: expect.stringContaining(error) },
      ]);
    },
  );

  test("lists the deploy that resets the checkpoint to release tables left in maintenance mode at it", async () => {
    writeRebaselineMarker(state.migrationsDir, "hlocal", {
      replacedHistoryId: "hprevious",
      replacedLatestMigration: 5,
    });
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: {
          "sdk-migration": "m0005",
          "sdk-migration-history": "hprevious",
          "sdk-maintenance-mode": "m0005",
        },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(true);
    const [row] = JSON.parse(stdout.output) as Record<string, unknown>[];
    expect(row).toMatchObject({
      status: "ok",
      checkpointRepair: { from: 5, to: 0 },
      maintenanceModeCheckpoint: 5,
      maintenanceModeCheckpointLabel: "0005",
      maintenanceModeRelease: { via: "deploy", command: "tailor", args: ["deploy", workspaceArg] },
    });
    expect((row?.maintenanceModeRelease as Record<string, unknown>).fallback).toBeUndefined();
  });

  test("does not suggest checkpoint moves without a local snapshot", async () => {
    fs.rmSync(state.migrationsDir, { recursive: true });
    fs.mkdirSync(state.migrationsDir);
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    const [{ error }] = JSON.parse(stdout.output);
    expect(error).toContain("Pull the latest migration files");
    expect(error).not.toContain("migration sync");
  });

  test("identifies a migration history mismatch in human-readable output", async () => {
    writeRebaselineMarker(state.migrationsDir, "hlocal");
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-history": "hremote" },
      },
    });
    using stderr = captureStderr();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(stderr.output).toContain(
      "Migration status error: Remote migration history ID hremote does not match local migration history ID hlocal.",
    );
    expect(stderr.output).not.toContain("Failed to read migration state");
  });

  test("accepts a matching remote migration history", async () => {
    writeRebaselineMarker(state.migrationsDir, "hlocal");
    client.getMetadata.mockResolvedValue({
      metadata: {
        labels: { "sdk-migration": "m0001", "sdk-migration-history": "hlocal" },
      },
    });
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        namespace: "tailordb",
        currentMigration: 1,
      },
    ]);
  });

  test("does not report a history mismatch for an undeployed namespace", async () => {
    writeRebaselineMarker(state.migrationsDir, "hlocal");
    client.getMetadata.mockRejectedValue(new ConnectError("metadata not found", Code.NotFound));
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        namespace: "tailordb",
        currentMigration: 0,
      },
    ]);
  });

  test("keeps reporting healthy namespaces when another namespace fails", async () => {
    vi.mocked(loadConfigFile).mockResolvedValue({
      kind: "config",
      config: {
        path: path.join(path.dirname(state.migrationsDir), "tailor.config.ts"),
        db: migrationDbConfig(["tailordb", "analyticsdb"], state.migrationsDir),
      },
    } as unknown as Awaited<ReturnType<typeof loadConfigFile>>);
    client.getMetadata.mockImplementation((request) =>
      request.trn?.endsWith("analyticsdb")
        ? Promise.reject(new ConnectError("unavailable", Code.Unavailable))
        : Promise.resolve({ metadata: { labels: { "sdk-migration": "m0001" } } }),
    );
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    const result = await runCommand(statusCommand, []);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(
      /Migration status check failed for 1 namespace: analyticsdb/,
    );
    expect(JSON.parse(stdout.output)).toMatchObject([
      {
        status: "ok",
        namespace: "tailordb",
        currentMigration: 1,
        pendingMigrations: [{ number: 2 }],
      },
      {
        status: "error",
        namespace: "analyticsdb",
        error: expect.stringContaining("unavailable"),
      },
    ]);
  });
});
