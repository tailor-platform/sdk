/**
 * Replaying a migration history into a workspace without a checkpoint must put
 * the workspace in the state of the baseline snapshot before the first script
 * runs, including every table a later migration removes or renames away. The
 * deploy plan holds no entry for such a table (the workspace lacks it and the
 * final schema omits it), so the migration that removes it deletes it itself.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { reconstructSnapshotFromMigrations } from "#/cli/commands/tailordb/migrate/snapshot";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
  deleteOrders,
  gqlPermissionEntry,
  mkPendingMigration,
  type RemoteCheckpoint,
  snapshotAt,
  snapshotTable,
  type SnapshotTablesByVersion,
  typeEntry,
} from "./test-helpers/migration-apply";
import { applyTailorDB } from "./index";
import type { OperatorClient } from "#/cli/shared/client";

vi.mock("./migration", async (importOriginal) => ({
  ...(await importOriginal()),
  detectPendingMigrations: vi.fn(),
  executeMigrations: vi.fn().mockResolvedValue(undefined),
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
  reconstructSnapshotFromMigrations: vi.fn(),
}));

const snapshotState = { tablesByVersion: {} as SnapshotTablesByVersion };

const NAMESPACE = "test-ns";
const nameField = { name: { type: "string", required: true } } as const;

describe("migration flow: replaying a history that removes tables into a fresh workspace", () => {
  let checkpoint: RemoteCheckpoint;

  beforeEach(() => {
    snapshotState.tablesByVersion = {};
    checkpoint = createRemoteCheckpoint(null);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
    vi.mocked(reconstructSnapshotFromMigrations).mockImplementation((_migrationsDir, maxVersion) =>
      snapshotAt(snapshotState.tablesByVersion, maxVersion),
    );
  });

  function createOrdersOf(client: OperatorClient, tableName: string) {
    const mock = vi.mocked(client.createTailorDBType).mock;
    return mock.calls.flatMap((call, index) =>
      (call[0] as { tailordbType?: { name?: string } }).tailordbType?.name === tableName
        ? [mock.invocationCallOrder[index]!]
        : [],
    );
  }

  function firstScriptOrder() {
    return vi.mocked(migrationModule.executeMigrations).mock.invocationCallOrder[0]!;
  }

  function checkpointOrder(number: number) {
    const mock = vi.mocked(migrationModule.updateMigrationLabel).mock;
    const index = mock.calls.findIndex((call) => call[3] === number);
    return mock.invocationCallOrder[index]!;
  }

  test("creates a baseline table that a later migration removes before the first script, and deletes it once after the removing migration's checkpoint", async () => {
    const tableA = snapshotTable("A", nameField);
    const tableB = snapshotTable("B", { aId: { type: "uuid", required: true } });
    const tableC = snapshotTable("C", { source: { type: "string", required: false } });
    const requiredC = snapshotTable("C", { source: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: { A: tableA, B: tableB, C: tableC },
      1: { A: tableA, B: tableB, C: requiredC },
      2: { B: tableB, C: requiredC },
    };
    const planResult = createPlanResult({
      type: { creates: [typeEntry("B"), typeEntry("C")] },
    });
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          kind: "field_modified",
          typeName: "C",
          tableName: "C",
          fieldName: "source",
          before: { type: "string", required: false },
          after: { type: "string", required: true },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ]),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "A", before: tableA } as any],
        { number: 2, hasScript: false },
      ),
    ]);
    const client = checkpoint.createMockClient();

    await applyTailorDB(client, planResult, "create-update");

    const created = createOrdersOf(client, "A");
    expect(created).toHaveLength(1);
    expect(created[0]).toBeLessThan(firstScriptOrder());
    const { table } = deleteOrders(client, NAMESPACE, "A");
    expect(table).toHaveLength(1);
    expect(table[0]).toBeGreaterThan(checkpointOrder(2));
  });

  test("creates a table that a later migration removes and re-adds, deletes it at the removal, and creates it again at the re-add", async () => {
    const audit = snapshotTable("Audit", nameField);
    const draft = snapshotTable("Draft", nameField);
    snapshotState.tablesByVersion = {
      0: { Audit: audit, Draft: draft },
      1: { Audit: audit, Draft: draft },
      2: { Audit: audit },
      3: { Audit: audit, Draft: draft },
    };
    const planResult = createPlanResult({
      type: { creates: [typeEntry("Draft"), typeEntry("Audit")] },
    });
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration([]),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "Draft", before: draft } as any],
        { number: 2, hasScript: false },
      ),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_added", tableName: "Draft" } as any],
        { number: 3, hasScript: false },
      ),
    ]);
    const client = checkpoint.createMockClient();

    await applyTailorDB(client, planResult, "create-update");

    const [baselineCreate, reAddCreate] = createOrdersOf(client, "Draft");
    expect(createOrdersOf(client, "Draft")).toHaveLength(2);
    expect(baselineCreate).toBeLessThan(firstScriptOrder());
    const { table } = deleteOrders(client, NAMESPACE, "Draft");
    expect(table).toHaveLength(1);
    expect(table[0]).toBeGreaterThan(checkpointOrder(2));
    expect(table[0]).toBeLessThan(reAddCreate!);
  });

  test("creates a baseline table that a later migration renames away, and deletes it after the renaming migration's checkpoint", async () => {
    const oldTable = snapshotTable("Old", nameField);
    const newTable = snapshotTable("New", nameField);
    snapshotState.tablesByVersion = {
      0: { Old: oldTable },
      1: { Old: oldTable },
      2: { New: newTable },
    };
    const planResult = createPlanResult({ type: { creates: [typeEntry("New")] } });
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration([]),
      mkPendingMigration(
        [
          {
            kind: "table_renamed",
            tableName: "New",
            previousTableName: "Old",
            before: oldTable,
            after: newTable,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
        { number: 2 },
      ),
    ]);
    const client = checkpoint.createMockClient();

    await applyTailorDB(client, planResult, "create-update");

    const created = createOrdersOf(client, "Old");
    expect(created).toHaveLength(1);
    expect(created[0]).toBeLessThan(firstScriptOrder());
    const { table } = deleteOrders(client, NAMESPACE, "Old");
    expect(table).toHaveLength(1);
    expect(table[0]).toBeGreaterThan(checkpointOrder(2));
  });

  test("deletes the GraphQL permission of a table it deletes at the removal, and applies it again at the re-add", async () => {
    const audit = snapshotTable("Audit", nameField);
    const draft = snapshotTable("Draft", nameField);
    snapshotState.tablesByVersion = {
      0: { Audit: audit, Draft: draft },
      1: { Audit: audit, Draft: draft },
      2: { Audit: audit },
      3: { Audit: audit, Draft: draft },
    };
    const planResult = createPlanResult({
      type: { creates: [typeEntry("Draft"), typeEntry("Audit")] },
      gqlPermission: { creates: [gqlPermissionEntry("Draft")] },
    });
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration([]),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "Draft", before: draft } as any],
        { number: 2, hasScript: false },
      ),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_added", tableName: "Draft" } as any],
        { number: 3, hasScript: false },
      ),
    ]);
    const client = checkpoint.createMockClient();

    await applyTailorDB(client, planResult, "create-update");

    const permissionCreates = vi
      .mocked(client.createTailorDBGQLPermission)
      .mock.invocationCallOrder.filter(
        (_order, index) =>
          vi.mocked(client.createTailorDBGQLPermission).mock.calls[index]?.[0].typeName === "Draft",
      );
    expect(permissionCreates).toHaveLength(2);
    const { table, permission } = deleteOrders(client, NAMESPACE, "Draft");
    expect(permission).toHaveLength(1);
    expect(permission[0]).toBeLessThan(table[0]!);
    expect(permissionCreates[1]).toBeGreaterThan(table[0]!);
  });

  test("does not create or delete a table the workspace already has when a later migration removes it", async () => {
    const tableA = snapshotTable("A", nameField);
    snapshotState.tablesByVersion = { 0: { A: tableA }, 1: { A: tableA }, 2: {} };
    const planResult = createPlanResult({
      type: {
        deletes: [
          {
            name: "A",
            request: {
              workspaceId: "test-workspace",
              namespaceName: NAMESPACE,
              tailordbTypeName: "A",
            },
          },
        ],
      },
    });
    checkpoint = createRemoteCheckpoint(0);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration([]),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "A", before: tableA } as any],
        { number: 2, hasScript: false },
      ),
    ]);
    const client = checkpoint.createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "A" }] },
    });

    await applyTailorDB(client, planResult, "create-update");

    expect(createOrdersOf(client, "A")).toHaveLength(0);
    expect(deleteOrders(client, NAMESPACE, "A").table).toHaveLength(1);
  });
});
