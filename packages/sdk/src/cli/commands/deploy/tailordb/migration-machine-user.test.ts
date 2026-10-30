import { describe, test, expect, vi, beforeEach } from "vitest";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
  mkPendingMigration,
  type RemoteCheckpoint,
  typeEntry,
} from "./test-helpers/migration-apply";
import { applyTailorDB, preflightTailorDB } from "./index";
import type { DiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { Application } from "#/cli/services/application";

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
  reconstructSnapshotFromMigrations: vi.fn().mockReturnValue({
    version: 1 as const,
    namespace: "test-ns",
    createdAt: new Date().toISOString(),
    tables: {},
  }),
}));

describe("applyTailorDB: machine user that runs migration scripts", () => {
  let checkpoint: RemoteCheckpoint;

  function buildPlanResult(
    machineUsers: Record<string, object>,
    migrationMachineUserOverride?: string,
  ) {
    return createPlanResult({
      type: {
        creates: [
          typeEntry("StockReservation", { fields: { id: { type: "uuid", required: true } } }),
        ],
      },
      application: {
        authService: { config: { name: "auth", machineUsers } },
      } as unknown as Partial<Application>,
      ...(migrationMachineUserOverride !== undefined && {
        context: { migrationMachineUserOverride },
      }),
    });
  }

  beforeEach(() => {
    checkpoint = createRemoteCheckpoint(0);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
    checkpoint.mockPending([
      mkPendingMigration([
        { kind: "table_added", tableName: "StockReservation" } as unknown as DiffChange,
      ]),
    ]);
  });

  test("rejects a migration script with no machine user to run it in the preflight", async () => {
    const client = checkpoint.createMockClient();

    await expect(preflightTailorDB(client, buildPlanResult({}))).rejects.toMatchObject({
      code: "MACHINE_USER_REQUIRED",
    });
    expect(client.setMetadata).not.toHaveBeenCalled();
  });

  test("runs the scripts as the given machine user in place of the configured one", async () => {
    const client = checkpoint.createMockClient();

    await applyTailorDB(
      client,
      buildPlanResult({ migrator: {}, admin: {} }, "admin"),
      "create-update",
    );

    const [context] = vi.mocked(migrationModule.executeMigrations).mock.calls[0]!;
    expect(context.machineUserByNamespace).toEqual(new Map([["test-ns", "admin"]]));
  });
});
