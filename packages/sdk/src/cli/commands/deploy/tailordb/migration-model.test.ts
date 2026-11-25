import { describe, expect, test, vi } from "vitest";
import {
  getLatestMigrationNumber,
  reconstructSnapshotFromMigrations,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { logger } from "#/cli/shared/logger";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
  gqlPermissionDeletion,
  gqlPermissionEntry,
  mkPendingMigration,
  snapshotAt,
  typeDeletion,
  typeMetaRequest,
} from "./test-helpers/migration-apply";
import {
  compareTables,
  createFakeNamespace,
  describeScenario,
  type ModelState,
  type ModelTrace,
  modelDiff,
  modelManifest,
  modelTable,
  simulateModelTraces,
  versionsOf,
} from "./test-helpers/migration-model";
import { applyTailorDB } from "./index";

vi.mock("./migration", async (importOriginal) => ({
  ...(await importOriginal()),
  detectPendingMigrations: vi.fn(),
  executeMigrations: vi.fn(),
  updateMigrationLabel: vi.fn(),
}));

vi.mock("#/cli/commands/tailordb/migrate/config", () => ({
  getNamespacesWithMigrations: vi.fn(() => [
    { namespace: "test-ns", migrationsDir: "/test/migrations" },
  ]),
}));

vi.mock("#/cli/commands/tailordb/migrate/snapshot", async (importOriginal) => ({
  ...(await importOriginal()),
  assertValidMigrationFiles: vi.fn(),
  getLatestMigrationNumber: vi.fn(),
  reconstructSnapshotFromMigrations: vi.fn(),
}));

const NAMESPACE = "test-ns";
const WORKSPACE_ID = "test-workspace";
const TABLE_NAMES = ["A", "B", "C"];

async function replay(trace: ModelTrace): Promise<string[]> {
  const failures: string[] = [];
  const { history, checkpoint, fresh } = trace;
  const last = history.at(-1) ?? new Map<string, number>();
  const start = trace.states[0]?.tables ?? new Map<string, number>();
  const expectedAt = (tag: "Script" | "Commit" | "Done", migration?: number) =>
    trace.states.find(
      (state) =>
        state.step.tag === tag &&
        (state.step.tag === "Done" || ("value" in state.step && state.step.value === migration)),
    );
  const fake = createFakeNamespace(NAMESPACE, start);
  const observe = (label: string, expected: ModelState | undefined) => {
    if (!expected) {
      failures.push(`${label}: the model has no such step`);
      return;
    }
    for (const line of compareTables(versionsOf(fake.tables), expected, TABLE_NAMES)) {
      failures.push(`${label}: ${line}`);
    }
  };

  const remoteCheckpoint = createRemoteCheckpoint(fresh ? null : checkpoint);
  vi.mocked(migrationModule.executeMigrations).mockImplementation(async (_context, migrations) => {
    for (const migration of migrations) {
      observe(`script ${migration.number}`, expectedAt("Script", migration.number));
    }
  });
  vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(async (...args) => {
    observe(`commit ${args[3]}`, expectedAt("Commit", args[3]));
    return remoteCheckpoint.record(...args);
  });
  const tablesByVersion = Object.fromEntries(
    history.map((schema, i) => [
      i,
      Object.fromEntries([...schema].map(([name, version]) => [name, modelTable(name, version)])),
    ]),
  );
  vi.mocked(reconstructSnapshotFromMigrations).mockImplementation((_dir, maxVersion) =>
    snapshotAt(tablesByVersion, maxVersion),
  );
  vi.mocked(getLatestMigrationNumber).mockReturnValue(history.length - 1);

  const entryOf = ([name, version]: [string, number]) => ({
    name,
    request: {
      workspaceId: WORKSPACE_ID,
      namespaceName: NAMESPACE,
      tailordbType: modelManifest(name, version),
    },
    metaRequest: typeMetaRequest(name),
  });
  const creates = [...last].filter(([name]) => !start.has(name)).map(entryOf);
  const updates = [...last]
    .filter(([name, version]) => start.has(name) && start.get(name) !== version)
    .map(entryOf);
  const deleted = [...start.keys()].filter((name) => !last.has(name));
  const planResult = createPlanResult({
    type: { creates, updates, deletes: deleted.map((name) => typeDeletion(name)) },
    gqlPermission: {
      creates: creates.map((create) => gqlPermissionEntry(create.name)),
      deletes: deleted.map((name) => gqlPermissionDeletion(name)),
    },
    local: [...last].map(([name, version]) => modelTable(name, version)),
  });
  const pending = history.slice(checkpoint + 1).map((schema, offset) => {
    const number = checkpoint + 1 + offset;
    return mkPendingMigration(modelDiff(history[number - 1] ?? new Map(), schema), {
      number,
      hasScript: trace.scripted.has(number),
    });
  });
  planResult.context.pendingMigrations = remoteCheckpoint.mockPending(pending);
  const client = remoteCheckpoint.createMockClient(fake.overrides);
  const info = vi.spyOn(logger, "info");

  try {
    await applyTailorDB(client, planResult, "create-update");
    observe("done", expectedAt("Done"));
    const permissions = [...fake.tables]
      .filter(([, table]) => table.permission)
      .map(([name]) => name);
    const expectedPermissions = [...(expectedAt("Done")?.permissions ?? [])];
    if (permissions.toSorted().join() !== expectedPermissions.toSorted().join()) {
      failures.push(
        `done: permissions ${permissions.toSorted().join()}, expected ${expectedPermissions.toSorted().join()}`,
      );
    }
  } catch (error) {
    failures.push(`deploy failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  failures.push(...fake.rejections.map((rejection) => `rejected: ${rejection}`));
  if (
    info.mock.calls.some(([message]) => String(message).startsWith("Applied local definitions"))
  ) {
    failures.push("wrote local definitions that the last migration already has");
  }
  info.mockRestore();
  return failures;
}

describe("migration deploy model", () => {
  test(
    "each simulated deploy holds the tables migration-deploy.qnt expects",
    { timeout: 120_000 },
    async () => {
      const traces = simulateModelTraces(5000);
      expect(traces.length).toBeGreaterThan(4000);
      const failed: string[] = [];
      for (const trace of traces) {
        vi.clearAllMocks();
        const failures = await replay(trace);
        if (failures.length > 0)
          failed.push(`${describeScenario(trace)}\n  ${failures.join("\n  ")}`);
      }
      expect({ traces: traces.length, failed: failed.length, first: failed.slice(0, 15) }).toEqual({
        traces: traces.length,
        failed: 0,
        first: [],
      });
    },
  );
});
