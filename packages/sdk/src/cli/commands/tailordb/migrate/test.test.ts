import { describe, expect, test, vi } from "vitest";
import {
  runMigrationTest,
  type MigrationTestDependencies,
  type PreparedMigrationTest,
} from "./test";

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
      return { id: "44444444-4444-4444-8444-444444444444", name: "migration-test" };
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

    expect(events).toEqual(["prepare", "create", "baseline", "clone", "migrate", "delete"]);
    expect(dependencies.cloneData).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceWorkspaceId: prepared.sourceWorkspaceId,
        targetWorkspaceId: "44444444-4444-4444-8444-444444444444",
        applicationName: "migration-app",
      }),
    );
    expect(dependencies.seedData).not.toHaveBeenCalled();
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

    expect(events).toEqual(["prepare", "create", "baseline", "seed", "migrate", "delete"]);
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
});
