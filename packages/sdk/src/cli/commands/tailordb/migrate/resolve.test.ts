import * as fs from "node:fs";
import * as os from "node:os";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { CLIError } from "#/cli/shared/errors";
import { prompt } from "#/cli/shared/prompt";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { resolveCommand } from "./resolve";
import {
  parsedType,
  snapshotType,
  writeDiff,
  writeInitialSchema,
} from "./test-helpers/schema-fixtures";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  localTypes: {} as Record<string, unknown>,
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
  removeMigrationWorkflowResources: vi.fn(),
  assertNoActiveMigrationExecution: vi.fn(),
  readMigrationRunStatus: vi.fn(),
  stderr: [] as string[],
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

vi.mock("#/cli/commands/deploy/tailordb/migration-workflow", async (importOriginal) => ({
  ...(await importOriginal()),
  removeMigrationWorkflowResources: state.removeMigrationWorkflowResources,
  assertNoActiveMigrationExecution: state.assertNoActiveMigrationExecution,
  readMigrationRunStatus: state.readMigrationRunStatus,
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
      loadExecutors: vi.fn(() => Promise.resolve({})),
      loadPluginExecutorFiles: vi.fn(() => Promise.resolve(undefined)),
      get executors() {
        return {};
      },
    },
  })),
  generatePluginFilesIfNeeded: vi.fn(() => []),
}));

function remoteLabels(labels: Record<string, string>): void {
  state.getMetadata.mockResolvedValue({
    metadata: { labels: { "sdk-name": "my-app", ...labels } },
  });
}

const LOCAL_HISTORY_ID = "h0123456789abcdef0123456789abcdef";

function rebaselineLocalHistory(migrationsDir: string): void {
  const file = path.join(migrationsDir, "0000", "schema.json");
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  snapshot.rebaseline = {
    historyId: LOCAL_HISTORY_ID,
    replacedHistoryId: null,
    replacedLatestMigration: 0,
  };
  fs.writeFileSync(file, JSON.stringify(snapshot));
}

describe("tailordb migration resolve", () => {
  aroundEach(async (runTest) => {
    state.stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      state.stderr.push(String(chunk));
      return true;
    });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-resolve-test-"));
    state.migrationsDir = path.join(tmpDir, "migrations");

    writeInitialSchema(state.migrationsDir, { User: snapshotType("User") });
    writeDiff(state.migrationsDir, 1, [
      { kind: "table_added", typeName: "Post", after: snapshotType("Post") },
    ]);
    writeDiff(state.migrationsDir, 2, [
      { kind: "table_added", typeName: "Comment", after: snapshotType("Comment") },
    ]);
    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        path: path.join(tmpDir, "tailor.config.ts"),
        db: { tailordb: { migration: { directory: state.migrationsDir } } },
      },
      plugins: [],
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    state.localTypes = {
      User: parsedType("User"),
      Post: parsedType("Post"),
      Comment: parsedType("Comment"),
    };

    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [{ name: "User" }, { name: "Post" }, { name: "Comment" }],
      nextPageToken: "",
    });
    state.createTailorDBType.mockResolvedValue({});
    state.updateTailorDBType.mockResolvedValue({});
    state.deleteTailorDBType.mockResolvedValue({});
    state.listTailorDBGQLPermissions.mockResolvedValue({ permissions: [], nextPageToken: "" });
    state.createTailorDBGQLPermission.mockResolvedValue({});
    state.updateTailorDBGQLPermission.mockResolvedValue({});
    state.deleteTailorDBGQLPermission.mockResolvedValue({});
    state.setMetadata.mockResolvedValue({});
    state.removeMigrationWorkflowResources.mockResolvedValue(undefined);
    state.assertNoActiveMigrationExecution.mockResolvedValue(undefined);
    remoteLabels({ "sdk-migration": "m0001", "sdk-migration-in-progress": "m0002" });
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
    for (const mock of Object.values(state)) {
      if (typeof mock === "function") mock.mockReset();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function expectNothingWritten(): void {
    expect(state.createTailorDBType).not.toHaveBeenCalled();
    expect(state.updateTailorDBType).not.toHaveBeenCalled();
    expect(state.deleteTailorDBType).not.toHaveBeenCalled();
    expect(state.setMetadata).not.toHaveBeenCalled();
    expect(state.removeMigrationWorkflowResources).not.toHaveBeenCalled();
  }

  test("requires either --rollback or --complete", async () => {
    const result = await runCommand(resolveCommand, ["--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/--rollback or --complete/);
    expectNothingWritten();
  });

  test("rejects --rollback and --complete together", async () => {
    const result = await runCommand(resolveCommand, ["--rollback", "--complete", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/--rollback or --complete/);
    expectNothingWritten();
  });

  test("refuses when no migration is in progress", async () => {
    remoteLabels({ "sdk-migration": "m0002" });

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/No migration is in progress/);
    expectNothingWritten();
  });

  test("refuses an in-progress record the checkpoint already covers", async () => {
    remoteLabels({ "sdk-migration": "m0002", "sdk-migration-in-progress": "m0002" });

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/No migration is in progress/);
    expectNothingWritten();
  });

  test.each(["--rollback", "--complete"])(
    "%s refuses an in-progress record that skips the migration after the checkpoint",
    async (flag) => {
      remoteLabels({ "sdk-migration": "m0000", "sdk-migration-in-progress": "m0002" });

      const result = await runCommand(resolveCommand, [flag, "--yes"]);

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: "MIGRATION_RESOLVE_RECORD_INVALID" });
      expect(String(result.error)).toMatch(
        /records migration 0002 as in progress, but its checkpoint is 0000; the next migration to run would be 0001/,
      );
      expectNothingWritten();
    },
  );

  test.each(["--rollback", "--complete"])(
    "%s refuses an in-progress record other than 0001 when the workspace has no checkpoint",
    async (flag) => {
      remoteLabels({ "sdk-migration-in-progress": "m0002" });

      const result = await runCommand(resolveCommand, [flag, "--yes"]);

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: "MIGRATION_RESOLVE_RECORD_INVALID" });
      expect(String(result.error)).toMatch(
        /records migration 0002 as in progress, but its checkpoint is 0000; the next migration to run would be 0001/,
      );
      expectNothingWritten();
    },
  );

  test("--rollback sends the schema of the migration before the in-progress one", async () => {
    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(true);
    expect(
      state.updateTailorDBType.mock.calls.map(([call]) => call.tailordbType.name).toSorted(),
    ).toEqual(["Post", "User"]);
    expect(state.createTailorDBType).not.toHaveBeenCalled();
    expect(state.deleteTailorDBType).toHaveBeenCalledTimes(1);
    expect(state.deleteTailorDBType.mock.calls[0]![0]).toMatchObject({
      namespaceName: "tailordb",
      tailordbTypeName: "Comment",
    });
  });

  test("--rollback keeps the checkpoint and drops the in-progress record", async () => {
    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ labels: { "sdk-migration": "m0001", "sdk-name": "my-app" } }),
    );
  });

  test("--complete sends the schema of the in-progress migration", async () => {
    const result = await runCommand(resolveCommand, ["--complete", "--yes"]);

    expect(result.success).toBe(true);
    expect(
      state.updateTailorDBType.mock.calls.map(([call]) => call.tailordbType.name).toSorted(),
    ).toEqual(["Comment", "Post", "User"]);
    expect(state.deleteTailorDBType).not.toHaveBeenCalled();
  });

  test("removes the record of a maintenance mode a deploy left in place", async () => {
    remoteLabels({
      "sdk-migration": "m0001",
      "sdk-migration-in-progress": "m0002",
      "sdk-maintenance-mode": "m0001",
    });

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.not.objectContaining({ "sdk-maintenance-mode": expect.anything() }),
      }),
    );
  });

  test("leaves the maintenance mode record alone when sending the schema fails", async () => {
    remoteLabels({
      "sdk-migration": "m0001",
      "sdk-migration-in-progress": "m0002",
      "sdk-maintenance-mode": "m0001",
    });
    state.updateTailorDBType.mockRejectedValue(new Error("update failed"));

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(false);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  test("--complete moves the checkpoint to the in-progress migration and drops its record", async () => {
    const result = await runCommand(resolveCommand, ["--complete", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.setMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ labels: { "sdk-migration": "m0002", "sdk-name": "my-app" } }),
    );
  });

  test.each(["--rollback", "--complete"])(
    "%s removes the temporary resources of the in-progress migration",
    async (flag) => {
      const result = await runCommand(resolveCommand, [flag, "--yes"]);

      expect(result.success).toBe(true);
      expect(state.removeMigrationWorkflowResources).toHaveBeenCalledWith(
        expect.anything(),
        "12345678-1234-4abc-8def-123456789012",
        "tailordb",
        2,
      );
    },
  );

  test("a failed cleanup of the temporary resources does not fail the command", async () => {
    state.removeMigrationWorkflowResources.mockRejectedValue(new Error("cleanup failed"));

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(true);
    expect(state.stderr.join("")).toMatch(
      /Could not remove the temporary resources of migration tailordb\/0002: cleanup failed\. A later deploy removes them\./,
    );
  });

  test("keeps the in-progress record when sending the schema fails", async () => {
    state.updateTailorDBType.mockRejectedValue(new Error("update failed"));

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/update failed/);
    expect(state.setMetadata).not.toHaveBeenCalled();
    expect(state.removeMigrationWorkflowResources).not.toHaveBeenCalled();
  });

  test("prints where the namespace ended up under JSON output", async () => {
    using _json = jsonMode();
    using stdout = captureStdout();

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual({
      changed: true,
      workspaceId: "12345678-1234-4abc-8def-123456789012",
      namespace: "tailordb",
      resolution: "rollback",
      migrationNumber: 2,
      checkpoint: 1,
      tables: { created: [], updated: ["User", "Post"], deleted: ["Comment"] },
      gqlPermissions: { set: [], deleted: [] },
    });
  });

  test("--rollback warns that data written by completed steps stays and steps run again", async () => {
    await runCommand(resolveCommand, ["--rollback", "--yes"]);

    const output = state.stderr.join("");
    expect(output).toMatch(/does not undo the data changes/);
    expect(output).toMatch(/run again from the first step/);
    expect(output).toMatch(/Existing data in deleted tables will be lost/);
  });

  test("--complete warns when tables that exist only on the remote will be deleted", async () => {
    state.listTailorDBTypes.mockResolvedValue({
      tailordbTypes: [{ name: "User" }, { name: "Post" }, { name: "Comment" }, { name: "Legacy" }],
      nextPageToken: "",
    });

    await runCommand(resolveCommand, ["--complete", "--yes"]);

    expect(state.stderr.join("")).toMatch(/Existing data in deleted tables will be lost/);
    expect(state.deleteTailorDBType.mock.calls.map(([call]) => call.tailordbTypeName)).toEqual([
      "Legacy",
    ]);
  });

  test("refuses while an execution of the in-progress migration is still running", async () => {
    state.assertNoActiveMigrationExecution.mockRejectedValue(
      CLIError({
        code: "MIGRATION_EXECUTION_ACTIVE",
        message: "Migration tailordb/0002 has an execution that is still running (exec-live).",
      }),
    );

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/still running/);
    expect(state.assertNoActiveMigrationExecution).toHaveBeenCalledWith(
      expect.anything(),
      "12345678-1234-4abc-8def-123456789012",
      "tailordb",
      2,
    );
    expectNothingWritten();
  });

  test("refuses when the remote migration history differs from the local one", async () => {
    remoteLabels({
      "sdk-migration": "m0001",
      "sdk-migration-in-progress": "m0002",
      "sdk-migration-history": "h0123456789abcdef0123456789abcdef",
    });

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/does not match the local migration history/);
    expectNothingWritten();
  });

  test.each(["--rollback", "--complete"])(
    "%s works when the workspace has neither a checkpoint nor a history ID yet",
    async (flag) => {
      rebaselineLocalHistory(state.migrationsDir);
      remoteLabels({ "sdk-migration-in-progress": "m0001" });

      const result = await runCommand(resolveCommand, [flag, "--yes"]);

      expect(result.success).toBe(true);
      expect(state.setMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: expect.objectContaining({ "sdk-migration-history": LOCAL_HISTORY_ID }),
        }),
      );
    },
  );

  test("refuses a rebaselined checkout when the workspace has a checkpoint but no history ID", async () => {
    rebaselineLocalHistory(state.migrationsDir);
    remoteLabels({ "sdk-migration": "m0001", "sdk-migration-in-progress": "m0002" });

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/does not match the local migration history/);
    expectNothingWritten();
  });

  test("refuses when the remote migration history marker cannot be read", async () => {
    remoteLabels({
      "sdk-migration": "m0001",
      "sdk-migration-in-progress": "m0002",
      "sdk-migration-history": "INVALID",
    });

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/does not match the local migration history/);
    expectNothingWritten();
  });

  test("refuses when the migration state changed since it was read", async () => {
    state.getMetadata
      .mockResolvedValueOnce({
        metadata: {
          labels: {
            "sdk-name": "my-app",
            "sdk-migration": "m0001",
            "sdk-migration-in-progress": "m0002",
          },
        },
      })
      .mockResolvedValue({
        metadata: { labels: { "sdk-name": "my-app", "sdk-migration": "m0002" } },
      });

    const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/changed while the command was running/);
    expectNothingWritten();
  });

  test("--complete explains how to go on when records without a value reject the update", async () => {
    state.updateTailorDBType.mockRejectedValue(
      new ConnectError(
        'field "code" cannot be updated from non-required to required when records exist',
        Code.FailedPrecondition,
      ),
    );

    const result = await runCommand(resolveCommand, ["--complete", "--yes"]);

    expect(result.success).toBe(false);
    expect(state.stderr.join("")).toMatch(/run the command again.*stays in progress/s);
    expect(state.setMetadata).not.toHaveBeenCalled();
  });

  describe("a `main` run whose outcome an earlier deploy could not settle", () => {
    const executionId = "0190f3a2-7c1e-7d4b-9a6f-1b2c3d4e5f60";

    aroundEach(async (runTest) => {
      remoteLabels({
        "sdk-migration": "m0001",
        "sdk-migration-in-progress": "m0002-main",
        "sdk-migration-execution": "e0190f3a27c1e7d4b9a6f1b2c3d4e5f60",
      });
      state.readMigrationRunStatus.mockResolvedValue("succeeded");
      await runTest();
    });

    test("reads the outcome of the recorded run", async () => {
      const result = await runCommand(resolveCommand, ["--complete", "--yes"]);

      expect(result.success).toBe(true);
      expect(state.readMigrationRunStatus).toHaveBeenCalledWith(
        expect.anything(),
        "12345678-1234-4abc-8def-123456789012",
        "tailordb",
        { number: 2, executionId, main: true },
      );
      expect(state.stderr.join("")).toMatch(/Run: succeeded/);
      expect(state.setMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ labels: { "sdk-migration": "m0002", "sdk-name": "my-app" } }),
      );
    });

    test("reports the outcome of the run under JSON output", async () => {
      using _json = jsonMode();
      using stdout = captureStdout();

      const result = await runCommand(resolveCommand, ["--complete", "--yes"]);

      expect(result.success).toBe(true);
      expect(JSON.parse(stdout.output)).toMatchObject({
        resolution: "complete",
        migrationNumber: 2,
        checkpoint: 2,
        runStatus: "succeeded",
      });
    });

    test("--rollback warns that the data a succeeded run wrote is lost", async () => {
      const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

      expect(result.success).toBe(true);
      const output = state.stderr.join("");
      expect(output).toMatch(/run of migration 0002 succeeded/);
      expect(output).toMatch(/--complete/);
      expect(output).not.toMatch(/from the first step/);
    });

    test.each(["failed", "canceled", "not_started"])(
      "--complete warns that a run that %s left the data unmigrated",
      async (runStatus) => {
        state.readMigrationRunStatus.mockResolvedValue(runStatus);

        const result = await runCommand(resolveCommand, ["--complete", "--yes"]);

        expect(result.success).toBe(true);
        const output = state.stderr.join("");
        expect(output).toMatch(/did not succeed/);
        expect(output).toMatch(/--rollback/);
      },
    );

    test("warns that the outcome could not be confirmed", async () => {
      state.readMigrationRunStatus.mockResolvedValue("unknown");

      const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

      expect(result.success).toBe(true);
      expect(state.stderr.join("")).toMatch(/could not be confirmed/);
    });

    test("refuses before asking for confirmation while the run is still running", async () => {
      state.readMigrationRunStatus.mockResolvedValue("running");
      vi.mocked(prompt.confirm).mockClear();

      const result = await runCommand(resolveCommand, ["--complete"]);

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({ code: "MIGRATION_EXECUTION_ACTIVE" });
      expect(prompt.confirm).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("refuses when the record changed from a `main` run to steps while the command ran", async () => {
      state.getMetadata
        .mockResolvedValueOnce({
          metadata: {
            labels: {
              "sdk-name": "my-app",
              "sdk-migration": "m0001",
              "sdk-migration-in-progress": "m0002-main",
            },
          },
        })
        .mockResolvedValue({
          metadata: {
            labels: {
              "sdk-name": "my-app",
              "sdk-migration": "m0001",
              "sdk-migration-in-progress": "m0002",
            },
          },
        });

      const result = await runCommand(resolveCommand, ["--rollback", "--yes"]);

      expect(result.success).toBe(false);
      expect(String(result.error)).toMatch(/changed while the command was running/);
      expectNothingWritten();
    });
  });

  test("does not read the run of a migration whose steps partly committed", async () => {
    await runCommand(resolveCommand, ["--rollback", "--yes"]);

    expect(state.readMigrationRunStatus).not.toHaveBeenCalled();
  });

  test("declining the confirmation writes nothing", async () => {
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(resolveCommand, ["--rollback"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/cancelled/);
    expectNothingWritten();
  });
});
