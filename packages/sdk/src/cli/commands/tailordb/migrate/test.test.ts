import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCommand } from "@politty/zod";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runCliCommand } from "#/cli/shared/test-helpers/run-cli-command";
import {
  runMigrationTest,
  testCommand,
  type MigrationTestDependencies,
  type PreparedMigrationTest,
} from "./test";
import type * as TestRuntime from "./test-runtime";

const mocks = vi.hoisted(() => ({ dependencies: undefined as unknown }));

vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: vi.fn() }));
vi.mock("./test-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof TestRuntime>()),
  createMigrationTestDependencies: () => mocks.dependencies,
}));

const prepared: PreparedMigrationTest = {
  sourceWorkspaceId: "11111111-1111-4111-8111-111111111111",
  sourceApplicationName: "migration-app",
  temporaryWorkspace: {
    name: "migration-test-20260805-120000",
    region: "asia-northeast",
    organizationId: "22222222-2222-4222-8222-222222222222",
    folderId: "33333333-3333-4333-8333-333333333333",
  },
  baselines: new Map(),
  targetSnapshots: new Map(),
  baselineSnapshots: new Map(),
  pendingNamespaces: ["tailordb"],
};

function createDependencies(events: string[]): MigrationTestDependencies {
  return {
    prepare: vi.fn(async () => {
      events.push("prepare");
      return prepared;
    }),
    createWorkspace: vi.fn(async () => {
      events.push("create");
      return {
        id: "44444444-4444-4444-8444-444444444444",
        name: "migration-test",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      };
    }),
    recordWorkspaceExpiry: vi.fn(async () => {
      events.push("expiry");
    }),
    deployBaseline: vi.fn(async () => {
      events.push("baseline");
    }),
    seedData: vi.fn(async () => {
      events.push("seed");
    }),
    cloneData: vi.fn(async () => {
      events.push("clone");
    }),
    deployMigrations: vi.fn(async () => {
      events.push("migrate");
    }),
    runAssertion: vi.fn(async () => {
      events.push("assert");
    }),
    deleteWorkspace: vi.fn(async () => {
      events.push("delete");
    }),
  };
}

describe("tailordb migration test", () => {
  test("creates, seeds, migrates, asserts, and deletes a temporary workspace in order", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);

    const result = await runMigrationTest(
      {
        data: "seed",
        assertionPath: "./assert-migration.ts",
      },
      dependencies,
    );

    expect(events).toEqual([
      "prepare",
      "create",
      "expiry",
      "baseline",
      "seed",
      "migrate",
      "assert",
      "delete",
    ]);
    expect(result).toEqual({
      success: true,
      workspaceId: "44444444-4444-4444-8444-444444444444",
      workspaceName: "migration-test",
      temporary: true,
      deleted: true,
      data: "seed",
      pendingNamespaces: ["tailordb"],
    });
  });

  test("clones source data instead of loading seed fixtures", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);

    await runMigrationTest({ data: "clone" }, dependencies);

    expect(events).toEqual([
      "prepare",
      "create",
      "expiry",
      "baseline",
      "clone",
      "migrate",
      "delete",
    ]);
    expect(dependencies.cloneData).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceWorkspaceId: prepared.sourceWorkspaceId,
        targetWorkspaceId: "44444444-4444-4444-8444-444444444444",
        applicationName: "migration-app",
      }),
    );
    expect(dependencies.seedData).not.toHaveBeenCalled();
  });

  test("runs the pending migration scripts as the given machine user", async () => {
    const dependencies = createDependencies([]);

    await runMigrationTest({ data: "clone", machineUser: "admin" }, dependencies);

    expect(dependencies.deployMigrations).toHaveBeenCalledWith(
      expect.objectContaining({ machineUser: "admin" }),
    );
  });

  test("passes the clone timeout to the clone step", async () => {
    const dependencies = createDependencies([]);

    await runMigrationTest({ data: "clone", cloneTimeout: 600_000 }, dependencies);

    expect(dependencies.cloneData).toHaveBeenCalledWith(
      expect.objectContaining({ cloneTimeout: 600_000 }),
    );
  });

  test("converts --clone-timeout to milliseconds for the clone step", async () => {
    const dependencies = createDependencies([]);
    mocks.dependencies = dependencies;

    const result = await runCommand(testCommand, ["--data", "clone", "--clone-timeout", "10m"]);

    expect(result.success).toBe(true);
    expect(dependencies.cloneData).toHaveBeenCalledWith(
      expect.objectContaining({ cloneTimeout: 600_000 }),
    );
  });

  test("rejects an excessive --keep-ttl before creating a workspace", async () => {
    const dependencies = createDependencies([]);
    mocks.dependencies = dependencies;

    const result = await runCommand(testCommand, [
      "--data",
      "seed",
      "--keep",
      "--keep-ttl",
      "50000000d",
    ]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("TTL must be less than 50,000,000 days");
    expect(dependencies.createWorkspace).not.toHaveBeenCalled();
  });

  describe("organization and folder from an --env-file", () => {
    const organizationId = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
    const folderId = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
    const directories: string[] = [];

    beforeEach(() => {
      vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", undefined);
      vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", undefined);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    test.each([
      { ids: [organizationId, folderId], expected: { organizationId, folderId } },
      { ids: ["", ""], expected: { organizationId: undefined, folderId: undefined } },
    ])("passes the IDs $ids loaded by --env-file to the preparation step", async (row) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "migration-test-env-"));
      directories.push(directory);
      const envFile = path.join(directory, "location.env");
      const [organization, folder] = row.ids;
      fs.writeFileSync(
        envFile,
        `TAILOR_PLATFORM_ORGANIZATION_ID=${organization}\nTAILOR_PLATFORM_FOLDER_ID=${folder}\n`,
      );
      const dependencies = createDependencies([]);
      mocks.dependencies = dependencies;

      const result = await runCliCommand(testCommand, ["--env-file", envFile]);

      expect(result.success).toBe(true);
      expect(dependencies.prepare).toHaveBeenCalledWith(expect.objectContaining(row.expected));
    });

    test.each(["not-a-uuid", ""])("rejects --organization-id %j", async (value) => {
      const dependencies = createDependencies([]);
      mocks.dependencies = dependencies;

      const result = await runCliCommand(testCommand, ["--organization-id", value]);

      expect(result.success).toBe(false);
      expect(dependencies.prepare).not.toHaveBeenCalled();
    });
  });

  test("rejects a clone timeout with seed data before creating a workspace", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);

    await expect(
      runMigrationTest({ data: "seed", cloneTimeout: 600_000 }, dependencies),
    ).rejects.toMatchObject({
      code: "MIGRATION_TEST_OPTIONS_INVALID",
      message: "--clone-timeout was given without --data clone.",
      suggestion: "Pass --data clone, or remove --clone-timeout.",
    });

    expect(events).toEqual([]);
  });

  test("rejects a cross-region designated clone target before baseline deployment", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    const targetWorkspaceId = "55555555-5555-4555-8555-555555555555";
    vi.mocked(dependencies.prepare).mockImplementationOnce(async () => {
      events.push("prepare");
      return {
        ...prepared,
        designatedTarget: { id: targetWorkspaceId, region: "us-west" },
      };
    });

    await expect(
      runMigrationTest({ data: "clone", targetWorkspaceId, yes: true }, dependencies),
    ).rejects.toThrow(/same region/i);

    expect(events).toEqual(["prepare"]);
    expect(dependencies.deployBaseline).not.toHaveBeenCalled();
  });

  test("requires explicit acknowledgment for a designated target and never deletes it", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    const targetWorkspaceId = "55555555-5555-4555-8555-555555555555";

    await expect(
      runMigrationTest({ data: "seed", targetWorkspaceId }, dependencies),
    ).rejects.toThrow(/--yes/);
    expect(events).toEqual([]);

    const result = await runMigrationTest(
      { data: "seed", targetWorkspaceId, yes: true },
      dependencies,
    );

    expect(events).toEqual(["prepare", "baseline", "seed", "migrate"]);
    expect(dependencies.createWorkspace).not.toHaveBeenCalled();
    expect(dependencies.deleteWorkspace).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      workspaceId: targetWorkspaceId,
      temporary: false,
      deleted: false,
    });
  });

  test("rejects the source workspace as a designated target regardless of UUID casing", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);

    await expect(
      runMigrationTest(
        {
          data: "seed",
          targetWorkspaceId: prepared.sourceWorkspaceId.toUpperCase(),
          yes: true,
        },
        dependencies,
      ),
    ).rejects.toThrow(/target workspace must differ from the source workspace/i);

    expect(events).toEqual(["prepare"]);
    expect(dependencies.deployBaseline).not.toHaveBeenCalled();
  });

  test("rejects ambiguous assertion options before creating a workspace", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    vi.mocked(dependencies.prepare).mockImplementationOnce(async () => {
      events.push("prepare");
      return { ...prepared, pendingNamespaces: ["primary", "analytics"] };
    });

    await expect(
      runMigrationTest({ data: "seed", assertionPath: "./assert.ts" }, dependencies),
    ).rejects.toThrow(/--assert-namespace/);

    expect(events).toEqual(["prepare"]);
    expect(dependencies.createWorkspace).not.toHaveBeenCalled();
  });

  test("rejects an assertion namespace without an assertion script", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);

    await expect(
      runMigrationTest({ data: "seed", assertionNamespace: "tailordb" }, dependencies),
    ).rejects.toThrow(/--assert.*--assert-namespace/);

    expect(events).toEqual([]);
    expect(dependencies.createWorkspace).not.toHaveBeenCalled();
  });

  test("keeps an automatically-created workspace when --keep is passed", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);

    const result = await runMigrationTest({ data: "seed", keep: true }, dependencies);

    expect(events).toEqual(["prepare", "create", "baseline", "seed", "migrate"]);
    expect(dependencies.deleteWorkspace).not.toHaveBeenCalled();
    expect(result).toMatchObject({ temporary: true, deleted: false });
  });

  test("keeps an automatically-created workspace on failure when --keep is passed", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    vi.mocked(dependencies.deployMigrations).mockRejectedValueOnce(new Error("migration failed"));

    await expect(runMigrationTest({ data: "seed", keep: true }, dependencies)).rejects.toThrow(
      "migration failed",
    );

    expect(dependencies.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("records an expiry on a kept workspace right after creating it", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);

    await runMigrationTest({ data: "seed", keep: true, keepTtl: "24h" }, dependencies);

    expect(events.slice(0, 3)).toEqual(["prepare", "create", "expiry"]);
    expect(dependencies.recordWorkspaceExpiry).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      "24h",
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(dependencies.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("does not record an expiry on a kept workspace unless --keep-ttl is passed", async () => {
    const dependencies = createDependencies([]);

    await runMigrationTest({ data: "seed", keep: true }, dependencies);

    expect(dependencies.recordWorkspaceExpiry).not.toHaveBeenCalled();
  });

  test("records a 24h expiry on a temporary workspace before any deployment starts", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);

    await runMigrationTest({ data: "seed" }, dependencies);

    expect(events.slice(0, 4)).toEqual(["prepare", "create", "expiry", "baseline"]);
    expect(dependencies.recordWorkspaceExpiry).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      "24h",
      new Date("2026-01-01T00:00:00Z"),
    );
  });

  test("does not record an expiry on a designated target workspace", async () => {
    const dependencies = createDependencies([]);

    await runMigrationTest(
      { data: "seed", targetWorkspaceId: "55555555-5555-4555-8555-555555555555", yes: true },
      dependencies,
    );

    expect(dependencies.recordWorkspaceExpiry).not.toHaveBeenCalled();
  });

  test("still deletes the temporary workspace when the default expiry could not be recorded", async () => {
    const dependencies = createDependencies([]);
    vi.mocked(dependencies.recordWorkspaceExpiry).mockRejectedValue(
      new Error("label write failed"),
    );

    const result = await runMigrationTest({ data: "seed" }, dependencies);

    expect(result.deleted).toBe(true);
    expect(dependencies.deleteWorkspace).toHaveBeenCalledTimes(1);
  });

  test("keeps the workspace and finishes when recording the expiry fails", async () => {
    const dependencies = createDependencies([]);
    vi.mocked(dependencies.recordWorkspaceExpiry).mockRejectedValue(
      new Error("label write failed"),
    );

    const result = await runMigrationTest(
      { data: "seed", keep: true, keepTtl: "24h" },
      dependencies,
    );

    expect(result.deleted).toBe(false);
    expect(dependencies.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("rejects --keep-ttl without --keep before creating anything", async () => {
    const dependencies = createDependencies([]);

    await expect(
      runMigrationTest({ data: "seed", keepTtl: "24h" }, dependencies),
    ).rejects.toMatchObject({
      code: "MIGRATION_TEST_OPTIONS_INVALID",
      message: "--keep-ttl was given without --keep.",
      suggestion: "Pass --keep together with --keep-ttl, or remove --keep-ttl.",
    });
    expect(dependencies.createWorkspace).not.toHaveBeenCalled();
  });

  test("rejects --keep with a designated target workspace", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);

    await expect(
      runMigrationTest(
        {
          data: "seed",
          targetWorkspaceId: "55555555-5555-4555-8555-555555555555",
          yes: true,
          keep: true,
        },
        dependencies,
      ),
    ).rejects.toThrow(/--keep/);

    expect(events).toEqual([]);
  });

  test("deletes an automatically-created workspace when migration execution fails", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    vi.mocked(dependencies.deployMigrations).mockImplementationOnce(async () => {
      events.push("migrate");
      throw new Error("migration failed");
    });

    await expect(runMigrationTest({ data: "seed" }, dependencies)).rejects.toThrow(
      "migration failed",
    );

    expect(events).toEqual([
      "prepare",
      "create",
      "expiry",
      "baseline",
      "seed",
      "migrate",
      "delete",
    ]);
  });

  test("does not mask the migration error when temporary-workspace deletion also fails", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    vi.mocked(dependencies.deployMigrations).mockRejectedValueOnce(new Error("migration failed"));
    vi.mocked(dependencies.deleteWorkspace).mockRejectedValueOnce(new Error("delete failed"));

    await expect(runMigrationTest({ data: "seed" }, dependencies)).rejects.toThrow(
      "migration failed",
    );
  });

  test("reports the orphaned workspace ID when deletion is the only failure", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    vi.mocked(dependencies.deleteWorkspace).mockRejectedValueOnce(new Error("delete failed"));

    await expect(runMigrationTest({ data: "seed" }, dependencies)).rejects.toThrow(
      /44444444-4444-4444-8444-444444444444.*delete failed/,
    );
  });

  test("points at the workspace delete command for the orphaned workspace", async () => {
    const dependencies = createDependencies([]);
    vi.mocked(dependencies.deleteWorkspace).mockRejectedValueOnce(new Error("delete failed"));

    await expect(
      runMigrationTest({ data: "seed", profile: "staging" }, dependencies),
    ).rejects.toMatchObject({
      code: "MIGRATION_TEST_WORKSPACE_CLEANUP_FAILED",
      suggestion: "Delete the temporary workspace manually with TAILOR_PLATFORM_PROFILE=staging.",
      next: {
        command: "tailor",
        args: ["workspace", "delete", "--workspace-id", "44444444-4444-4444-8444-444444444444"],
      },
    });
  });
});
