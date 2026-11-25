import { describe, expect, test, vi } from "vitest";
import {
  getLatestMigrationNumber,
  reconstructSnapshotFromMigrations,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { logger } from "#/cli/shared/logger";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { assertDefined } from "#/utils/assert";
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
const stepLabel = (step: ModelState["step"]) =>
  step.tag === "Script" || step.tag === "Commit" ? `${step.tag} ${step.value}` : step.tag;

async function replay(trace: ModelTrace): Promise<string[]> {
  const failures: string[] = [];
  const { history, checkpoint, fresh } = trace;
  const last = assertDefined(history.at(-1), "every history has a last schema");
  const start = assertDefined(trace.states[0], "every trace has a Start state");
  const done = assertDefined(trace.states.at(-1), "every trace ends with Done");
  const fake = createFakeNamespace(NAMESPACE, start);
  const visited: string[] = [];
  const observe = (step: ModelState["step"]) => {
    const label = stepLabel(step);
    visited.push(label);
    const expected = trace.states.find((state) => stepLabel(state.step) === label);
    if (!expected) {
      failures.push(`${label}: the model has no such step`);
      return;
    }
    for (const line of compareTables(versionsOf(fake.tables), expected)) {
      failures.push(`${label}: ${line}`);
    }
  };

  const remoteCheckpoint = createRemoteCheckpoint(fresh ? null : checkpoint);
  vi.mocked(migrationModule.executeMigrations).mockImplementation(async (_context, migrations) => {
    for (const migration of migrations) observe({ tag: "Script", value: migration.number });
  });
  vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(async (...args) => {
    observe({ tag: "Commit", value: args[3] });
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
  const creates = [...last].filter(([name]) => !start.tables.has(name)).map(entryOf);
  const updates = [...last]
    .filter(([name, version]) => start.tables.has(name) && start.tables.get(name) !== version)
    .map(entryOf);
  const deletes = [...start.tables.keys()].filter((name) => !last.has(name));
  const planResult = createPlanResult({
    type: { creates, updates, deletes: deletes.map((name) => typeDeletion(name)) },
    gqlPermission: {
      creates: [...last.keys()]
        .filter((name) => !start.permissions.has(name))
        .map((name) => gqlPermissionEntry(name)),
      deletes: [...start.permissions]
        .filter((name) => !last.has(name))
        .map((name) => gqlPermissionDeletion(name)),
    },
    local: [...last].map(([name, version]) => modelTable(name, version)),
  });
  const pending = history.slice(checkpoint + 1).map((schema, offset) => {
    const number = checkpoint + 1 + offset;
    const before = assertDefined(history[number - 1], "every pending migration has a predecessor");
    return mkPendingMigration(modelDiff(before, schema), {
      number,
      hasScript: trace.scripted.has(number),
    });
  });
  planResult.context.pendingMigrations = remoteCheckpoint.mockPending(pending);
  const client = remoteCheckpoint.createMockClient(fake.overrides);
  using _logger = silenceLogger("success", "warn", "log", "newline");
  const info = vi.spyOn(logger, "info").mockImplementation(() => {});

  try {
    await applyTailorDB(client, planResult, "create-update");
    observe(done.step);
    const permissions = [...fake.tables]
      .filter(([, table]) => table.permission)
      .map(([name]) => name)
      .toSorted();
    const expectedPermissions = [...done.permissions].toSorted();
    if (permissions.join() !== expectedPermissions.join()) {
      failures.push(
        `Done: permissions ${permissions.join()}, expected ${expectedPermissions.join()}`,
      );
    }
    const expectedSteps = trace.states.slice(1).map((state) => stepLabel(state.step));
    if (visited.join() !== expectedSteps.join()) {
      failures.push(`steps ${visited.join(", ")}, expected ${expectedSteps.join(", ")}`);
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
