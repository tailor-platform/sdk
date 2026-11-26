/**
 * Replaying a migration history into a workspace without a checkpoint must put
 * the workspace in the state of the baseline snapshot before the first script
 * runs, including every table a later migration removes or renames away. The
 * deploy plan holds no entry for such a table (the workspace lacks it and the
 * final schema omits it), so the migration that removes it deletes it itself.
 * Likewise, a table a pending migration adds and a later one removes exists from
 * the adding migration's script until the removing migration's checkpoint.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { reconstructSnapshotFromMigrations } from "#/cli/commands/tailordb/migrate/snapshot";
import { protoGqlPermission } from "#/cli/commands/tailordb/migrate/snapshot-manifest";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
  deleteOrders,
  gqlPermissionDeletion,
  gqlPermissionEntry,
  mkPendingMigration,
  type RemoteCheckpoint,
  snapshotAt,
  snapshotTable,
  type SnapshotTablesByVersion,
  tailordbTypeWrites,
  typeDeletion,
  typeEntry,
  typeUnchanged,
} from "./test-helpers/migration-apply";
import { applyTailorDB } from "./index";
import type { DiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
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
const allowAll = [{ conditions: [], actions: ["all"], permit: "allow" }] as const;

describe("migration flow: replaying a history that removes tables", () => {
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

  function permissionCreateOrdersOf(client: OperatorClient, tableName: string) {
    const mock = vi.mocked(client.createTailorDBGQLPermission).mock;
    return mock.invocationCallOrder.filter(
      (_order, index) => mock.calls[index]?.[0].typeName === tableName,
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

  function scriptOrder(number: number) {
    const mock = vi.mocked(migrationModule.executeMigrations).mock;
    const index = mock.calls.findIndex((call) => call[1][0]?.number === number);
    return mock.invocationCallOrder[index]!;
  }

  function startAtCheckpoint(number: number) {
    checkpoint = createRemoteCheckpoint(number);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
  }

  const item = snapshotTable("Item", nameField);
  const archive = { ...snapshotTable("Archive", nameField), permissions: { gql: allowAll } };

  function addAndRemoveArchive(options?: Parameters<typeof createPlanResult>[0]) {
    snapshotState.tablesByVersion = {
      0: { Item: item },
      1: { Item: item, Archive: archive },
      2: { Item: item },
    };
    startAtCheckpoint(0);
    const planResult = createPlanResult(options);
    planResult.context.pendingMigrations = checkpoint.mockPending([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "Archive" } as any]),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "Archive", before: archive } as any],
        { number: 2, hasScript: false },
      ),
    ]);
    return planResult;
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

  test("creates the GraphQL permission of a baseline table it creates for a later removal, and deletes the permission before the table", async () => {
    const tableA = { ...snapshotTable("A", nameField), permissions: { gql: allowAll } };
    const tableC = snapshotTable("C", nameField);
    snapshotState.tablesByVersion = {
      0: { A: tableA, C: tableC },
      1: { A: tableA, C: tableC },
      2: { C: tableC },
    };
    const planResult = createPlanResult({
      type: { creates: [typeEntry("C")] },
      local: [tableC],
    });
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration([]),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "A", before: tableA } as any],
        { number: 2, hasScript: false },
      ),
    ]);
    const client = checkpoint.createMockClient();

    await applyTailorDB(client, planResult, "create-update");

    const created = createOrdersOf(client, "A");
    const permissionCreates = permissionCreateOrdersOf(client, "A");
    expect(permissionCreates).toHaveLength(1);
    expect(permissionCreates[0]).toBeGreaterThan(created[0]!);
    expect(permissionCreates[0]).toBeLessThan(firstScriptOrder());
    const { table, permission } = deleteOrders(client, NAMESPACE, "A");
    expect(permission).toHaveLength(1);
    expect(permission[0]).toBeGreaterThan(checkpointOrder(2));
    expect(permission[0]).toBeLessThan(table[0]!);
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

  test("deletes a table at each removal when a later migration removes and re-adds it twice", async () => {
    const audit = snapshotTable("Audit", nameField);
    const draft = snapshotTable("Draft", nameField);
    snapshotState.tablesByVersion = {
      0: { Audit: audit, Draft: draft },
      1: { Audit: audit, Draft: draft },
      2: { Audit: audit },
      3: { Audit: audit, Draft: draft },
      4: { Audit: audit },
      5: { Audit: audit, Draft: draft },
    };
    const planResult = createPlanResult({
      type: { creates: [typeEntry("Draft"), typeEntry("Audit")] },
    });
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_removed", tableName: "Draft", before: draft } as any], {
        number: 2,
        hasScript: false,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "Draft" } as any], {
        number: 3,
        hasScript: false,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_removed", tableName: "Draft", before: draft } as any], {
        number: 4,
        hasScript: false,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "Draft" } as any], {
        number: 5,
        hasScript: false,
      }),
    ]);
    const client = checkpoint.createMockClient();

    await applyTailorDB(client, planResult, "create-update");

    expect(createOrdersOf(client, "Draft")).toHaveLength(3);
    expect(deleteOrders(client, NAMESPACE, "Draft").table).toHaveLength(2);
  });

  test("applies a migration's schema change to a baseline table a later migration removes, before and after that migration's script", async () => {
    const before = snapshotTable("A", nameField);
    const after = snapshotTable("A", { ...nameField, source: { type: "string", required: true } });
    const tableC = snapshotTable("C", nameField);
    snapshotState.tablesByVersion = {
      0: { A: before, C: tableC },
      1: { A: after, C: tableC },
      2: { C: tableC },
    };
    const planResult = createPlanResult({ type: { creates: [typeEntry("C")] }, local: [tableC] });
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration([
        {
          kind: "field_added",
          typeName: "A",
          tableName: "A",
          fieldName: "source",
          after: { type: "string", required: true },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ]),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "A", before: after } as any],
        { number: 2, hasScript: false },
      ),
    ]);
    const client = checkpoint.createMockClient();

    await applyTailorDB(client, planResult, "create-update");

    const mock = vi.mocked(client.updateTailorDBType).mock;
    const withSource = mock.invocationCallOrder.filter((_order, index) => {
      const type = mock.calls[index]?.[0].tailordbType;
      return type?.name === "A" && type.schema?.fields?.source !== undefined;
    });
    expect(withSource).toHaveLength(2);
    expect(withSource[0]).toBeLessThan(firstScriptOrder());
    expect(withSource[1]).toBeGreaterThan(firstScriptOrder());
  });

  test("creates a table the plan deletes again where a pending migration adds it back after an earlier one deleted it, and deletes it at the next removal", async () => {
    const tableA = { ...snapshotTable("A", nameField), permissions: { gql: allowAll } };
    snapshotState.tablesByVersion = { 0: { A: tableA }, 1: {}, 2: { A: tableA }, 3: {} };
    const planResult = createPlanResult({
      type: { deletes: [typeDeletion("A")] },
      gqlPermission: { deletes: [gqlPermissionDeletion("A")] },
      local: [],
    });
    startAtCheckpoint(0);
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "A", before: tableA } as any],
        { number: 1, hasScript: false },
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "A" } as any], { number: 2 }),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "A", before: tableA } as any],
        { number: 3, hasScript: false },
      ),
    ]);
    const client = checkpoint.createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "A" }] },
    });

    await applyTailorDB(client, planResult, "create-update");

    const created = createOrdersOf(client, "A");
    expect(created).toHaveLength(1);
    const { table, permission } = deleteOrders(client, NAMESPACE, "A");
    expect(table).toHaveLength(2);
    expect(permissionCreateOrdersOf(client, "A")).toHaveLength(1);
    expect(permission).toHaveLength(2);
    expect(permission[1]).toBeGreaterThan(checkpointOrder(3));
    expect(permission[1]).toBeLessThan(table[1]!);
    expect(created[0]).toBeGreaterThan(table[0]!);
    expect(created[0]).toBeLessThan(scriptOrder(2));
    expect(table[1]).toBeGreaterThan(checkpointOrder(3));
    const updates = vi.mocked(client.updateTailorDBType).mock;
    const updatesOfA = updates.invocationCallOrder.filter(
      (_order, index) => updates.calls[index]?.[0].tailordbType?.name === "A",
    );
    expect(updatesOfA.filter((order) => order > table[0]!)).toHaveLength(0);
  });

  test("creates a table that a pending migration adds and a later one removes before the adding migration's script, and deletes it after the removing migration's checkpoint", async () => {
    const planResult = addAndRemoveArchive({ local: [item] });
    const client = checkpoint.createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "Item" }] },
    });

    await applyTailorDB(client, planResult, "create-update");

    const created = createOrdersOf(client, "Archive");
    expect(created).toHaveLength(1);
    expect(created[0]).toBeLessThan(scriptOrder(1));
    expect(client.createTailorDBType).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "test-workspace",
        namespaceName: NAMESPACE,
        tailordbType: expect.objectContaining({ name: "Archive" }),
      }),
    );
    const permissionCreates = permissionCreateOrdersOf(client, "Archive");
    expect(permissionCreates).toHaveLength(1);
    expect(permissionCreates[0]).toBeGreaterThan(created[0]!);
    expect(permissionCreates[0]).toBeLessThan(scriptOrder(1));
    expect(client.createTailorDBGQLPermission).toHaveBeenCalledWith({
      workspaceId: "test-workspace",
      namespaceName: NAMESPACE,
      typeName: "Archive",
      permission: protoGqlPermission(allowAll),
    });
    const { table, permission } = deleteOrders(client, NAMESPACE, "Archive");
    expect(table).toHaveLength(1);
    expect(table[0]).toBeGreaterThan(checkpointOrder(2));
    expect(permission).toHaveLength(1);
    expect(permission[0]).toBeLessThan(table[0]!);
  });

  test("does not create a table that only pending migrations define in a namespace without local definitions", async () => {
    const planResult = addAndRemoveArchive();
    const client = checkpoint.createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "Item" }] },
    });

    await applyTailorDB(client, planResult, "create-update");

    expect(createOrdersOf(client, "Archive")).toHaveLength(0);
  });

  test("deletes the table a failed migration added for its script when it rolls the migration back", async () => {
    const planResult = addAndRemoveArchive({ local: [item] });
    vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(new Error("script failed"));
    const client = checkpoint.createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "Item" }] },
    });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "script failed",
    );

    expect(createOrdersOf(client, "Archive")).toHaveLength(1);
    const { table } = deleteOrders(client, NAMESPACE, "Archive");
    expect(table).toHaveLength(1);
    expect(table[0]).toBeGreaterThan(scriptOrder(1));
    expect(checkpoint.state.number).toBe(0);
  });

  test("creates the table a pending migration renames a table to and a later one renames it away, before the first rename's script", async () => {
    const oldTable = snapshotTable("Old", nameField);
    const midTable = snapshotTable("Mid", nameField);
    const newTable = snapshotTable("New", nameField);
    snapshotState.tablesByVersion = {
      0: { Old: oldTable },
      1: { Mid: midTable },
      2: { New: newTable },
    };
    startAtCheckpoint(0);
    const planResult = createPlanResult({
      type: { creates: [typeEntry("New")], deletes: [typeDeletion("Old")] },
      local: [newTable],
    });
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration([
        {
          kind: "table_renamed",
          tableName: "Mid",
          previousTableName: "Old",
          before: oldTable,
          after: midTable,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ]),
      mkPendingMigration(
        [
          {
            kind: "table_renamed",
            tableName: "New",
            previousTableName: "Mid",
            before: midTable,
            after: newTable,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
        { number: 2 },
      ),
    ]);
    const client = checkpoint.createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "Old" }] },
    });

    await applyTailorDB(client, planResult, "create-update");

    const created = createOrdersOf(client, "Mid");
    expect(created).toHaveLength(1);
    expect(created[0]).toBeLessThan(scriptOrder(1));
    const { table } = deleteOrders(client, NAMESPACE, "Mid");
    expect(table).toHaveLength(1);
    expect(table[0]).toBeGreaterThan(checkpointOrder(2));
  });

  test("creates a baseline table again where a pending migration adds it back after the replay deleted it, when the final schema lacks it", async () => {
    const audit = snapshotTable("Audit", nameField);
    const draft = snapshotTable("Draft", nameField);
    snapshotState.tablesByVersion = {
      0: { Audit: audit, Draft: draft },
      1: { Audit: audit },
      2: { Audit: audit, Draft: draft },
      3: { Audit: audit },
    };
    const planResult = createPlanResult({
      type: { creates: [typeEntry("Audit")] },
      local: [audit],
    });
    planResult.context.pendingMigrations = checkpoint.mockPending([
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "Draft", before: draft } as any],
        { hasScript: false },
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "Draft" } as any], { number: 2 }),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "Draft", before: draft } as any],
        { number: 3, hasScript: false },
      ),
    ]);
    const client = checkpoint.createMockClient();

    await applyTailorDB(client, planResult, "create-update");

    const created = createOrdersOf(client, "Draft");
    expect(created).toHaveLength(2);
    const { table } = deleteOrders(client, NAMESPACE, "Draft");
    expect(table).toHaveLength(2);
    expect(created[1]).toBeGreaterThan(table[0]!);
    expect(created[1]).toBeLessThan(scriptOrder(2));
    expect(table[1]).toBeGreaterThan(checkpointOrder(3));
  });

  test("does not create a table a pending migration adds that the workspace already has", async () => {
    const planResult = addAndRemoveArchive({
      type: { deletes: [typeDeletion("Archive")] },
      local: [item],
    });
    const client = checkpoint.createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "Item" }, { name: "Archive" }] },
    });

    await applyTailorDB(client, planResult, "create-update");

    expect(createOrdersOf(client, "Archive")).toHaveLength(0);
    expect(deleteOrders(client, NAMESPACE, "Archive").table).toHaveLength(1);
  });

  test("does not create a table a pending migration adds that the last pending migration keeps while the local definitions lack it, since no migration deletes it again", async () => {
    snapshotState.tablesByVersion = { 0: { Item: item }, 1: { Item: item, Archive: archive } };
    startAtCheckpoint(0);
    const planResult = createPlanResult({ local: [item] });
    planResult.context.pendingMigrations = checkpoint.mockPending([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "Archive" } as any], {
        hasScript: false,
      }),
    ]);
    const client = checkpoint.createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "Item" }] },
    });

    await applyTailorDB(client, planResult, "create-update");

    expect(createOrdersOf(client, "Archive")).toHaveLength(0);
  });

  test("applies a migration's schema change to a table the workspace has and the plan deletes", async () => {
    const before = snapshotTable("A", nameField);
    const after = snapshotTable("A", { ...nameField, source: { type: "string", required: true } });
    snapshotState.tablesByVersion = { 0: { A: before }, 1: { A: after }, 2: {} };
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
      mkPendingMigration([
        {
          kind: "field_added",
          typeName: "A",
          tableName: "A",
          fieldName: "source",
          after: { type: "string", required: true },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ]),
      mkPendingMigration(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [{ kind: "table_removed", tableName: "A", before: after } as any],
        { number: 2, hasScript: false },
      ),
    ]);
    const client = checkpoint.createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "A" }] },
    });

    await applyTailorDB(client, planResult, "create-update");

    const mock = vi.mocked(client.updateTailorDBType).mock;
    const withSource = mock.invocationCallOrder.filter((_order, index) => {
      const type = mock.calls[index]?.[0].tailordbType;
      return type?.name === "A" && type.schema?.fields?.source !== undefined;
    });
    expect(withSource).toHaveLength(2);
    expect(deleteOrders(client, NAMESPACE, "A").table).toHaveLength(1);
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

  test("applies the GraphQL permission again for a table the replay removed and the local definitions recreate", async () => {
    const audit = snapshotTable("Audit", nameField);
    const draft = snapshotTable("Draft", nameField);
    snapshotState.tablesByVersion = {
      0: { Audit: audit, Draft: draft },
      1: { Audit: audit, Draft: draft },
      2: { Audit: audit },
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
    ]);
    const client = checkpoint.createMockClient();

    await applyTailorDB(client, planResult, "create-update");

    const mock = vi.mocked(client.createTailorDBGQLPermission).mock;
    const permissionCreates = mock.invocationCallOrder.filter(
      (_order, index) => mock.calls[index]?.[0].typeName === "Draft",
    );
    const { table } = deleteOrders(client, NAMESPACE, "Draft");
    expect(table).toHaveLength(1);
    expect(permissionCreates).toHaveLength(2);
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

  describe("a table the workspace has and the local definitions keep, which a pending migration removes", () => {
    const tableA = snapshotTable("A", nameField);
    const withF2 = snapshotTable("A", { ...nameField, f2: { type: "string", required: false } });

    function scriptOrder(number: number) {
      const mock = vi.mocked(migrationModule.executeMigrations).mock;
      const index = mock.calls.findIndex((call) => call[1].some((m) => m.number === number));
      return mock.invocationCallOrder[index]!;
    }

    function permissionCreateOrders(client: OperatorClient, tableName: string) {
      const mock = vi.mocked(client.createTailorDBGQLPermission).mock;
      return mock.invocationCallOrder.filter(
        (_order, index) => mock.calls[index]?.[0].typeName === tableName,
      );
    }

    function recreatePlan() {
      return createPlanResult({
        type: { creates: [typeEntry("A")], deletes: [typeDeletion("A")] },
        gqlPermission: {
          creates: [gqlPermissionEntry("A")],
          deletes: [gqlPermissionDeletion("A")],
        },
        local: [tableA],
      });
    }

    function workspaceAtCheckpoint(number: number) {
      checkpoint = createRemoteCheckpoint(number);
      vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
      return checkpoint.createMockClient({
        listTailorDBTypes: { tailordbTypes: [{ name: "A" }] },
      });
    }

    test("keeps the table with its records until the removing migration's checkpoint, then deletes it and creates it again at the re-add", async () => {
      snapshotState.tablesByVersion = {
        0: { A: tableA },
        1: { A: withF2 },
        2: {},
        3: {},
        4: { A: tableA },
      };
      const planResult = recreatePlan();
      const client = workspaceAtCheckpoint(0);
      planResult.context.pendingMigrations = checkpoint.mockPending([
        mkPendingMigration([
          {
            kind: "field_added",
            tableName: "A",
            fieldName: "f2",
            after: { type: "string", required: false },
          },
        ]),
        mkPendingMigration([{ kind: "table_removed", tableName: "A", before: withF2 }], {
          number: 2,
          hasScript: false,
        }),
        mkPendingMigration([], { number: 3 }),
        mkPendingMigration([{ kind: "table_added", tableName: "A", after: tableA }], {
          number: 4,
          hasScript: false,
        }),
      ]);

      await applyTailorDB(client, planResult, "create-update");

      const withF2Writes = tailordbTypeWrites(client).filter(
        (write) => write.name === "A" && write.tailordbType.schema?.fields?.f2 !== undefined,
      );
      expect(withF2Writes[0]?.order).toBeLessThan(scriptOrder(1));
      const { table, permission } = deleteOrders(client, NAMESPACE, "A");
      expect(table).toHaveLength(1);
      expect(table[0]).toBeGreaterThan(checkpointOrder(2));
      expect(table[0]).toBeLessThan(scriptOrder(3));
      expect(permission).toHaveLength(1);
      expect(permission[0]).toBeLessThan(table[0]!);
      const created = createOrdersOf(client, "A");
      expect(created).toHaveLength(1);
      expect(created[0]).toBeGreaterThan(table[0]!);
      const permissionCreates = permissionCreateOrders(client, "A");
      expect(permissionCreates).toHaveLength(1);
      expect(permissionCreates[0]).toBeGreaterThan(created[0]!);
    });

    test("drops the foreign key of a table the plan leaves unchanged before the removal deletes its target, and adds it back after the re-add", async () => {
      const toA = { type: "uuid", required: false } as const;
      const keepWithKey = snapshotTable("Keep", {
        aId: { ...toA, foreignKey: true, foreignKeyType: "A", foreignKeyField: "id" },
      });
      const keepWithoutKey = snapshotTable("Keep", { aId: toA });
      snapshotState.tablesByVersion = {
        0: { A: tableA, Keep: keepWithKey },
        1: { Keep: keepWithoutKey },
        2: { Keep: keepWithoutKey },
        3: { A: tableA, Keep: keepWithKey },
      };
      const planResult = createPlanResult({
        type: {
          creates: [typeEntry("A")],
          deletes: [typeDeletion("A")],
          unchanged: [typeUnchanged("Keep")],
        },
        local: [tableA, keepWithKey],
      });
      checkpoint = createRemoteCheckpoint(0);
      vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
      const client = checkpoint.createMockClient({
        listTailorDBTypes: { tailordbTypes: [{ name: "A" }, { name: "Keep" }] },
      });
      planResult.context.pendingMigrations = checkpoint.mockPending([
        mkPendingMigration(
          [
            { kind: "table_removed", tableName: "A", before: tableA },
            {
              kind: "field_modified",
              tableName: "Keep",
              fieldName: "aId",
              before: keepWithKey.fields.aId!,
              after: toA,
            },
          ],
          { hasScript: false },
        ),
        mkPendingMigration([], { number: 2 }),
        mkPendingMigration(
          [
            { kind: "table_added", tableName: "A", after: tableA },
            {
              kind: "field_modified",
              tableName: "Keep",
              fieldName: "aId",
              before: toA,
              after: keepWithKey.fields.aId!,
            },
          ],
          { number: 3, hasScript: false },
        ),
      ]);

      await applyTailorDB(client, planResult, "create-update");

      const keepWrites = tailordbTypeWrites(client).filter((write) => write.name === "Keep");
      const hasKey = (write: (typeof keepWrites)[number]) =>
        write.tailordbType.schema?.fields?.aId?.foreignKey === true;
      const { table } = deleteOrders(client, NAMESPACE, "A");
      expect(table).toHaveLength(1);
      const beforeDeletion = keepWrites.filter((write) => write.order < table[0]!);
      expect(beforeDeletion.length).toBeGreaterThan(0);
      expect(hasKey(beforeDeletion.at(-1)!)).toBe(false);
      const last = keepWrites.at(-1)!;
      expect(last.order).toBeGreaterThan(createOrdersOf(client, "A")[0]!);
      expect(hasKey(last)).toBe(true);
    });

    const tableT = snapshotTable("T", nameField);
    const oldT = snapshotTable("OldT", nameField);

    type AddingCase = {
      adding: string;
      checkpoint: SnapshotTablesByVersion[number];
      change: DiffChange;
    };

    test.each<AddingCase>([
      {
        adding: "adds",
        checkpoint: {},
        change: { kind: "table_added", tableName: "T", after: tableT },
      },
      {
        adding: "renames another table to",
        checkpoint: { OldT: oldT },
        change: {
          kind: "table_renamed",
          tableName: "T",
          previousTableName: "OldT",
          before: oldT,
          after: tableT,
        },
      },
    ])(
      "keeps a table the plan leaves unchanged when a failed migration that $adding it rolls back",
      async ({ checkpoint: checkpointTables, change }) => {
        snapshotState.tablesByVersion = { 0: checkpointTables, 1: { T: tableT } };
        const planResult = createPlanResult({
          type: { unchanged: [typeUnchanged("T")] },
          local: [tableT],
        });
        checkpoint = createRemoteCheckpoint(0);
        vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
        const client = checkpoint.createMockClient({
          listTailorDBTypes: { tailordbTypes: [{ name: "T" }] },
        });
        planResult.context.pendingMigrations = checkpoint.mockPending([
          mkPendingMigration([change]),
        ]);
        vi.mocked(migrationModule.executeMigrations).mockRejectedValueOnce(
          new Error("script failed"),
        );

        await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
          "script failed",
        );

        expect(deleteOrders(client, NAMESPACE, "T").table).toHaveLength(0);
      },
    );

    test("deletes the GraphQL permission at the removal only after a migration applied it, when the workspace's table has none", async () => {
      snapshotState.tablesByVersion = {
        0: { A: tableA },
        1: { A: tableA },
        2: {},
        3: { A: tableA },
      };
      const planResult = createPlanResult({
        type: { creates: [typeEntry("A")], deletes: [typeDeletion("A")] },
        gqlPermission: { creates: [gqlPermissionEntry("A")] },
        local: [tableA],
      });
      const client = workspaceAtCheckpoint(0);
      planResult.context.pendingMigrations = checkpoint.mockPending([
        mkPendingMigration([], { hasScript: false }),
        mkPendingMigration([{ kind: "table_removed", tableName: "A", before: tableA }], {
          number: 2,
          hasScript: false,
        }),
        mkPendingMigration([{ kind: "table_added", tableName: "A", after: tableA }], {
          number: 3,
          hasScript: false,
        }),
      ]);

      await applyTailorDB(client, planResult, "create-update");

      const { permission } = deleteOrders(client, NAMESPACE, "A");
      const permissionCreates = permissionCreateOrders(client, "A");
      expect(permission).toHaveLength(1);
      expect(permissionCreates).toHaveLength(2);
      expect(permissionCreates[0]).toBeLessThan(permission[0]!);
      expect(permissionCreates[1]).toBeGreaterThan(permission[0]!);
    });

    const removeA = () =>
      mkPendingMigration([{ kind: "table_removed", tableName: "A", before: tableA }], {
        number: 2,
        hasScript: false,
      });

    type RemovalCase = {
      name: string;
      tablesByVersion: SnapshotTablesByVersion;
      pending: () => ReturnType<typeof mkPendingMigration>[];
    };

    test.each<RemovalCase>([
      {
        name: "a table the checkpoint lacks, until the migration that removes it",
        tablesByVersion: { 0: {}, 1: { A: tableA }, 2: {}, 3: { A: tableA } },
        pending: () => [
          mkPendingMigration([{ kind: "table_added", tableName: "A", after: tableA }]),
          removeA(),
          mkPendingMigration([{ kind: "table_added", tableName: "A", after: tableA }], {
            number: 3,
            hasScript: false,
          }),
        ],
      },
      {
        name: "a table no later migration adds back, then creates it from the local definitions",
        tablesByVersion: { 0: { A: tableA }, 1: { A: tableA }, 2: {} },
        pending: () => [mkPendingMigration([]), removeA()],
      },
    ])(
      "keeps $name, deletes it at the removal, and creates it once after",
      async ({ tablesByVersion, pending }) => {
        snapshotState.tablesByVersion = tablesByVersion;
        const planResult = recreatePlan();
        const client = workspaceAtCheckpoint(0);
        planResult.context.pendingMigrations = checkpoint.mockPending(pending());

        await applyTailorDB(client, planResult, "create-update");

        const { table } = deleteOrders(client, NAMESPACE, "A");
        expect(table).toHaveLength(1);
        expect(table[0]).toBeGreaterThan(checkpointOrder(2));
        const created = createOrdersOf(client, "A");
        expect(created).toHaveLength(1);
        expect(created[0]).toBeGreaterThan(table[0]!);
      },
    );
  });
});
