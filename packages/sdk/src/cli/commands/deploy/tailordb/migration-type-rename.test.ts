/**
 * A table rename migration must create the new table in the Pre-phase, keep the
 * old type alive while the copy script runs, and drop the old type (and its
 * GQL permission) only after the checkpoint advances.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { reconstructSnapshotFromMigrations } from "#/cli/commands/tailordb/migrate/snapshot";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
  gqlPermissionDeletion,
  mkPendingMigration,
  type RemoteCheckpoint,
  snapshotAt,
  typeDeletion,
  typeEntry,
} from "./test-helpers/migration-apply";
import { applyTailorDB } from "./index";
import type { DiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";

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
  reconstructSnapshotFromMigrations: vi.fn(),
}));

const userType = {
  name: "User",
  pluralForm: "Users",
  fields: {
    email: { type: "string", required: false },
  },
};
const personType = {
  name: "Person",
  pluralForm: "People",
  fields: {
    email: { type: "string", required: false },
  },
};
const orderType = (ownerTarget: string) => ({
  name: "Order",
  pluralForm: "Orders",
  fields: {
    ownerId: {
      type: "uuid",
      required: false,
      foreignKey: true,
      foreignKeyType: ownerTarget,
      foreignKeyField: "id",
    },
  },
});

const tablesByMigration = {
  0: { User: userType, Order: orderType("User") },
  1: { Person: personType, Order: orderType("Person") },
};

describe("applyTailorDB: type rename migration flow", () => {
  function buildPlanResult(options: { withOrderUpdate?: boolean } = {}) {
    return createPlanResult({
      type: {
        creates: [typeEntry("Person", { fields: personType.fields })],
        updates: options.withOrderUpdate
          ? [typeEntry("Order", { fields: orderType("Person").fields })]
          : [],
        deletes: [typeDeletion("User")],
      },
      gqlPermission: { deletes: [gqlPermissionDeletion("User")] },
    });
  }

  function mkTypeRenameMigration(
    number: number,
    options: { withOrderRetarget?: boolean } = {},
  ): PendingMigration {
    const changes = [
      {
        kind: "table_renamed",
        tableName: "Person",
        previousTableName: "User",
        before: userType,
        after: personType,
      },
      ...(options.withOrderRetarget
        ? [
            {
              kind: "field_modified",
              tableName: "Order",
              fieldName: "ownerId",
              before: {
                type: "uuid",
                required: false,
                foreignKey: true,
                foreignKeyType: "User",
                foreignKeyField: "id",
              },
              after: {
                type: "uuid",
                required: false,
                foreignKey: true,
                foreignKeyType: "Person",
                foreignKeyField: "id",
              },
            },
          ]
        : []),
    ] as DiffChange[];
    return mkPendingMigration(changes, {
      number,
      diff: {
        hasBreakingChanges: true,
        breakingChanges: [{ tableName: "Person", reason: "Type renamed from User to Person" }],
      },
    });
  }

  function setPendingMigrations(migrations: PendingMigration[]) {
    return checkpoint.mockPending(migrations);
  }

  let checkpoint: RemoteCheckpoint;

  beforeEach(() => {
    checkpoint = createRemoteCheckpoint(0);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
    vi.mocked(reconstructSnapshotFromMigrations).mockImplementation((_migrationsDir, maxVersion) =>
      snapshotAt(tablesByMigration, maxVersion),
    );
  });

  test("creates the new table before the script and drops the old table after the checkpoint", async () => {
    const client = checkpoint.createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "User" }] },
    });
    const planResult = buildPlanResult();
    planResult.context.pendingMigrations = setPendingMigrations([mkTypeRenameMigration(1)]);

    const order: string[] = [];
    client.createTailorDBType.mockImplementation(async (request) => {
      order.push(`create:${request.tailordbType?.name}`);
      return {};
    });
    vi.mocked(migrationModule.executeMigrations).mockImplementation(async () => {
      order.push("script");
    });
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(async (...args) => {
      order.push("checkpoint");
      return checkpoint.record(...args);
    });
    client.deleteTailorDBGQLPermission.mockImplementation(async (request) => {
      order.push(`delete-perm:${request.typeName}`);
      return {};
    });
    client.deleteTailorDBType.mockImplementation(async (request) => {
      order.push(`delete-type:${request.tailordbTypeName}`);
      return {};
    });

    await applyTailorDB(client, planResult, "create-update");

    expect(order).toEqual([
      "create:Person",
      "script",
      "checkpoint",
      "delete-perm:User",
      "delete-type:User",
    ]);
  });

  test("keeps the old type and does not advance the checkpoint when the script fails", async () => {
    const client = checkpoint.createMockClient();
    const planResult = buildPlanResult();
    planResult.context.pendingMigrations = setPendingMigrations([mkTypeRenameMigration(1)]);
    vi.mocked(migrationModule.executeMigrations).mockRejectedValue(
      new Error("rpc error: code = Aborted desc = copy failed"),
    );

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow("copy failed");

    // Rollback removes the type created by the Pre-phase...
    const deleted = client.deleteTailorDBType.mock.calls.map(
      ([request]) => request.tailordbTypeName,
    );
    expect(deleted).toContain("Person");
    // ...but never the old type that still holds the data.
    expect(deleted).not.toContain("User");
    expect(migrationModule.updateMigrationLabel).not.toHaveBeenCalled();
  });

  test("restores retargeted tables before deleting the new table on rollback", async () => {
    const client = checkpoint.createMockClient();
    const planResult = buildPlanResult({ withOrderUpdate: true });
    planResult.context.pendingMigrations = setPendingMigrations([
      mkTypeRenameMigration(1, { withOrderRetarget: true }),
    ]);
    vi.mocked(migrationModule.executeMigrations).mockResolvedValue();

    const order: string[] = [];
    client.updateTailorDBType.mockImplementation(async (request) => {
      const name = request.tailordbType?.name;
      order.push(`update:${name}`);
      // The Post-phase update, the first to point Order at Person, may have been applied when it fails.
      if (name === "Order" && order.filter((entry) => entry === "update:Order").length === 2) {
        throw new Error("post-phase failed");
      }
      return {};
    });
    client.deleteTailorDBType.mockImplementation(async (request) => {
      order.push(`delete-type:${request.tailordbTypeName}`);
      return {};
    });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      "post-phase failed",
    );

    // Order must be restored to its prior schema (pointing back at User)
    // before Person is deleted, or the delete would be rejected while Order
    // still references Person.
    expect(order).toEqual([
      "update:Order", // Pre-phase
      "update:Order", // Post-phase, failed
      "update:Order", // rollback restore
      "delete-type:Person",
    ]);
  });
});
