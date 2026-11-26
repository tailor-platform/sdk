import { beforeAll, describe, expect, test, vi } from "vitest";
import {
  getLatestMigrationNumber,
  reconstructSnapshotFromMigrations,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { compareSnapshots } from "#/cli/commands/tailordb/migrate/snapshot-comparison";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { assertDefined } from "#/utils/assert";
import * as migrationModule from "./migration";
import {
  createRemoteCheckpoint,
  mkPendingMigration,
  mockConfig,
  snapshotAt,
} from "./test-helpers/migration-apply";
import {
  compareTables,
  countModelCases,
  createFakeNamespace,
  describeScenario,
  type ModelState,
  type ModelTrace,
  modelTable,
  observeTables,
  simulateModelTraces,
} from "./test-helpers/migration-model";
import { applyTailorDB, type MaintenanceModeRelease, planTailorDB } from "./index";
import type { Application } from "#/cli/services/application";

vi.mock("./migration", async (importOriginal) => ({
  ...(await importOriginal()),
  assertPendingMigrationsRunnable: vi.fn(),
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
const APP_NAME = "test-app";
const stepLabel = (step: ModelState["step"]) =>
  step.tag === "Script" || step.tag === "Commit" ? `${step.tag} ${step.value}` : step.tag;

const MAINTENANCE_MODES = {
  DuringMigrations: "migration",
  DuringDeploy: "deploy",
  Off: false,
} as const;

const LOOSENING_CHANGES = [
  "field added",
  "field removed",
  "field made optional",
  "field made non-unique",
  "enum added",
  "enum removed",
  "enum values added",
];
const TIGHTENING_CHANGES = ["field made required", "field made unique", "enum values removed"];
const COVERED_CASES = [
  ...Object.keys(MAINTENANCE_MODES).flatMap((mode) =>
    ["checkpoint", "fresh workspace"].map((start) => `maintenance ${mode}, ${start}`),
  ),
  ...["scripted", "unscripted"].flatMap((kind) => [
    `${kind} migration adds a table`,
    `${kind} migration removes a table`,
    ...LOOSENING_CHANGES.map((change) => `${kind} migration: ${change}`),
  ]),
  ...TIGHTENING_CHANGES.map((change) => `scripted migration: ${change}`),
  "data-only migration",
  "migration leaves no tables",
  "fresh workspace with an empty baseline",
  "checkpoint without tables",
  "table only pending migrations define",
  "table a pending migration removes and a later one adds again",
  "fresh workspace table a pending migration removes",
  "workspace table a pending migration removes",
];
const MIN_CASE_COUNT = 10;
const TRACE_COUNT = 3000;
const MIN_DISTINCT_TRACES = TRACE_COUNT * 0.95;

function modelApplication(): Application {
  return {
    name: APP_NAME,
    env: {},
    tailorDBServices: [
      { namespace: NAMESPACE, config: {}, types: {}, typeSourceInfo: {}, loadTypes: vi.fn() },
    ],
    executorService: undefined,
    authServices: [{ config: { name: "auth", machineUsers: { migrator: {} } } }],
  } as unknown as Application;
}

async function replay(trace: ModelTrace): Promise<string[]> {
  const failures: string[] = [];
  const { history, checkpoint, fresh } = trace;
  const lastNumber = history.length - 1;
  const start = assertDefined(trace.states[0], "every trace has a Start state");
  const fake = createFakeNamespace(NAMESPACE, start);
  const visited: string[] = [];
  let writesBeforeLastCommit: number | undefined;
  const observe = (step: ModelState["step"]) => {
    const label = stepLabel(step);
    visited.push(label);
    if (label === `Commit ${lastNumber}`) writesBeforeLastCommit = fake.writes.length;
    for (const violation of fake.violations.splice(0))
      failures.push(`before ${label}: ${violation}`);
    const expected = trace.states.find((state) => stepLabel(state.step) === label);
    if (!expected) {
      failures.push(`${label}: the model has no such step`);
      return;
    }
    for (const line of compareTables(observeTables(fake.tables), expected)) {
      failures.push(`${label}: ${line}`);
    }
  };

  const remoteCheckpoint = createRemoteCheckpoint(fresh ? null : checkpoint);
  vi.mocked(migrationModule.executeMigrations).mockImplementation(async (_context, migrations) => {
    for (const migration of migrations) {
      observe({ tag: "Script", value: migration.number });
      fake.runScript(assertDefined(history[migration.number], "every migration has a schema"));
    }
  });
  vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(async (...args) => {
    observe({ tag: "Commit", value: args[3] });
    return remoteCheckpoint.record(...args);
  });
  const tablesByVersion = Object.fromEntries(
    history.map((schema, i) => [
      i,
      Object.fromEntries([...schema].map(([name, shape]) => [name, modelTable(name, shape)])),
    ]),
  );
  vi.mocked(reconstructSnapshotFromMigrations).mockImplementation((_dir, maxVersion) =>
    snapshotAt(tablesByVersion, maxVersion),
  );
  vi.mocked(getLatestMigrationNumber).mockReturnValue(lastNumber);
  remoteCheckpoint.mockPending(
    history
      .map((_schema, number) => number)
      .filter((number) => number > checkpoint)
      .map((number) =>
        mkPendingMigration(
          compareSnapshots(
            snapshotAt(tablesByVersion, number - 1),
            snapshotAt(tablesByVersion, number),
          ).changes,
          { number, hasScript: trace.scripted.has(number) },
        ),
      ),
  );
  const client = remoteCheckpoint.createMockClient(fake.overrides);
  using _logger = silenceLogger("info", "success", "warn", "log", "newline");

  try {
    const planResult = await planTailorDB({
      client,
      workspaceId: WORKSPACE_ID,
      application: modelApplication(),
      applications: [],
      owner: { kind: "application", name: APP_NAME, id: undefined },
      forRemoval: false,
      config: { ...mockConfig, maintenanceMode: MAINTENANCE_MODES[trace.maintenance] },
      noSchemaCheck: true,
      migrationTestSnapshots: new Map([[NAMESPACE, snapshotAt(tablesByVersion, lastNumber)]]),
    });
    const releases: MaintenanceModeRelease[] = [];
    await applyTailorDB(client, planResult, "create-update", {
      holdMaintenanceMode: (release) => releases.push(release),
    });
    if (releases.length > 0) {
      observe({ tag: "Held" });
      for (const release of releases) await release(client);
    }
    observe({ tag: "Done" });
    const expectedSteps = trace.states.slice(1).map((state) => stepLabel(state.step));
    if (visited.join() !== expectedSteps.join()) {
      failures.push(`steps ${visited.join(", ")}, expected ${expectedSteps.join(", ")}`);
    }
  } catch (error) {
    failures.push(`deploy failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  failures.push(...fake.rejections.map((rejection) => `rejected: ${rejection}`));
  failures.push(...fake.violations.map((violation) => `after the last step: ${violation}`));
  // The local definitions equal the last migration, so only the restore writes after it.
  const afterLastCommit = fake.writes.slice(writesBeforeLastCommit ?? fake.writes.length);
  const updates = Map.groupBy(
    afterLastCommit.filter((write) => write.kind === "update"),
    (write) => write.table,
  );
  for (const write of afterLastCommit.filter((entry) => entry.kind === "create")) {
    failures.push(`created ${write.table} after the last migration committed`);
  }
  for (const [table, writes] of updates) {
    if (writes.length > 1) {
      failures.push(`updated ${table} ${writes.length} times after the last migration committed`);
    }
  }
  return failures;
}

describe("migration deploy model", () => {
  let traces: ModelTrace[] = [];
  beforeAll(() => {
    traces = simulateModelTraces(TRACE_COUNT);
  }, 120_000);

  test("the simulated deploys reach each case often enough", () => {
    const counts = countModelCases(traces);
    expect({
      enoughTraces: traces.length >= MIN_DISTINCT_TRACES,
      rare: COVERED_CASES.filter((name) => (counts.get(name) ?? 0) < MIN_CASE_COUNT).map(
        (name) => `${name}: ${counts.get(name) ?? 0}`,
      ),
    }).toEqual({ enoughTraces: true, rare: [] });
  });

  test(
    "each simulated deploy holds what migration-deploy.qnt expects at every step",
    { timeout: 120_000 },
    async () => {
      const failed: string[] = [];
      for (const trace of traces) {
        vi.clearAllMocks();
        const failures = await replay(trace);
        if (failures.length > 0)
          failed.push(`${trace.file} ${describeScenario(trace)}\n  ${failures.join("\n  ")}`);
      }
      expect({ failed: failed.length, first: failed.slice(0, 15) }).toEqual({
        failed: 0,
        first: [],
      });
    },
  );
});
