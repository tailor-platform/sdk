/**
 * Breaking table-level index changes must be relaxed in the Pre-phase (previous
 * definition, or absent for additions) so migrate.ts can reconcile duplicate
 * rows before the Post-phase enforces the unique index.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { reconstructSnapshotFromMigrations } from "#/cli/commands/tailordb/migrate/snapshot";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
  mkPendingMigration,
  type RemoteCheckpoint,
  snapshotAt,
} from "./test-helpers/migration-apply";
import { applyTailorDB } from "./index";
import type { DiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";

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

const userType = (indexes: Record<string, { fields: string[]; unique?: boolean }>) => ({
  name: "User",
  pluralForm: "Users",
  fields: {
    name: { type: "string", required: true },
    org: { type: "string", required: true },
  },
  indexes,
});

const tablesByMigration = {
  0: {},
  // Migration 1 adds a new unique index over (name, org).
  1: { User: userType({ name_org: { fields: ["name", "org"], unique: true } }) },
  // Migration 2 turns the existing name_idx into a unique index.
  2: { User: userType({ name_idx: { fields: ["name"], unique: true } }) },
};

describe("migration flow: breaking index changes across Pre/Post phases", () => {
  function createMockPlanResult() {
    return createPlanResult({
      type: {
        updates: [
          {
            name: "User",
            request: {
              workspaceId: "test-workspace",
              namespaceName: "test-ns",
              tailordbType: { name: "User", schema: { fields: {} } },
            },
          },
        ],
      },
      application: { authService: undefined },
    });
  }

  function mkIndexMigration(number: number, change: Record<string, unknown>): PendingMigration {
    return mkPendingMigration([change as unknown as DiffChange], {
      number,
      hasScript: false,
      diff: {
        hasBreakingChanges: true,
        breakingChanges: [{ tableName: "User", reason: "Unique constraint added to index" }],
        requiresMigrationScript: true,
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sentIndexes(call: readonly unknown[]): Record<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((call[0] as any)?.tailordbType?.schema?.indexes ?? {}) as Record<string, any>;
  }

  let checkpoint: RemoteCheckpoint;

  beforeEach(() => {
    checkpoint = createRemoteCheckpoint(null);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
    vi.mocked(reconstructSnapshotFromMigrations).mockImplementation((_migrationsDir, maxVersion) =>
      snapshotAt(tablesByMigration, maxVersion),
    );
  });

  test("prePhase omits a newly-added unique index; postPhase applies it", async () => {
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkIndexMigration(1, {
        kind: "index_added",
        tableName: "User",
        indexName: "name_org",
        after: { fields: ["name", "org"], unique: true },
      }),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    expect(updateCalls).toHaveLength(2);

    expect(sentIndexes(updateCalls[0]!).name_org).toBeUndefined();
    expect(sentIndexes(updateCalls[1]!).name_org).toEqual({
      fieldNames: ["name", "org"],
      unique: true,
    });
  });

  test("prePhase keeps the previous definition for an index gaining unique; postPhase enforces it", async () => {
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkIndexMigration(2, {
        kind: "index_modified",
        tableName: "User",
        indexName: "name_idx",
        before: { fields: ["name"], unique: false },
        after: { fields: ["name"], unique: true },
      }),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    expect(updateCalls).toHaveLength(2);

    expect(sentIndexes(updateCalls[0]!).name_idx).toEqual({
      fieldNames: ["name"],
      unique: false,
    });
    expect(sentIndexes(updateCalls[1]!).name_idx).toEqual({
      fieldNames: ["name"],
      unique: true,
    });
  });
});
