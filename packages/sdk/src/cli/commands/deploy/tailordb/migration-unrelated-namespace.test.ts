/**
 * When some namespace has pending migrations, the whole apply takes the
 * migration flow — but that flow must not drop changes planned for OTHER
 * namespaces that have no pending migration (e.g. a fresh deploy where the
 * main namespace runs its baseline migration while a second namespace has
 * plain tables to create).
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
  gqlPermissionEntry,
  mkPendingMigration as createPendingMigration,
  type RemoteCheckpoint,
  typeDeletion,
  typeEntry,
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
  reconstructSnapshotFromMigrations: vi.fn().mockReturnValue({
    version: 1,
    namespace: "test-ns",
    createdAt: "2026-01-01T00:00:00.000Z",
    tables: {
      User: {
        name: "User",
        pluralForm: "users",
        fields: { name: { type: "string", required: true } },
      },
    },
  }),
}));

describe("migration flow: namespaces without pending migrations", () => {
  function createMockPlanResult() {
    return createPlanResult({
      type: {
        creates: [typeEntry("Event", { namespace: "analytics-ns" })],
        updates: [typeEntry("Session", { namespace: "analytics-ns" })],
        deletes: [typeDeletion("Legacy", "analytics-ns")],
      },
      gqlPermission: { creates: [gqlPermissionEntry("Event", "analytics-ns")] },
      application: { authService: undefined },
    });
  }

  function mkPendingMigration(): PendingMigration {
    return createPendingMigration(
      [{ kind: "table_added", typeName: "User" } as unknown as DiffChange],
      { number: 0, hasScript: false },
    );
  }

  let checkpoint: RemoteCheckpoint;

  beforeEach(() => {
    checkpoint = createRemoteCheckpoint(null);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
  });

  test("applies type and gqlPermission changes of a namespace without pending migrations", async () => {
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration()]);

    await applyTailorDB(client, planResult, "create-update");

    const createdTypes = vi.mocked(client.createTailorDBType).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = call[0] as any;
      return `${request.namespaceName}/${request.tailordbType?.name}`;
    });
    expect(createdTypes).toContain("analytics-ns/Event");

    const updatedTypes = vi.mocked(client.updateTailorDBType).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = call[0] as any;
      return `${request.namespaceName}/${request.tailordbType?.name}`;
    });
    expect(updatedTypes).toContain("analytics-ns/Session");

    const createdPermissions = vi
      .mocked(client.createTailorDBGQLPermission)
      .mock.calls.map((call) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const request = call[0] as any;
        return `${request.namespaceName}/${request.typeName}`;
      });
    expect(createdPermissions).toContain("analytics-ns/Event");

    const deletedTypes = vi.mocked(client.deleteTailorDBType).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = call[0] as any;
      return `${request.namespaceName}/${request.tailordbTypeName}`;
    });
    expect(deletedTypes).toContain("analytics-ns/Legacy");
  });
  test("writes the metadata of tables planned alongside a migration", async () => {
    // The migration flow applies tables through its own phases, so it has to write
    // their metadata itself. Leaving it to the non-migration branch would skip a
    // cross-config dependency record on any deploy that carries a migration, and
    // the owner's next solo deploy would turn publishing off without asking.
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult();

    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([mkPendingMigration()]);

    await applyTailorDB(client, planResult, "create-update");

    const trns = vi.mocked(client.setMetadata).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (call[0] as any).trn as string;
    });
    expect(trns).toContain("trn:v1:workspace:test-workspace:tailordb:analytics-ns:type:Event");
    expect(trns).toContain("trn:v1:workspace:test-workspace:tailordb:analytics-ns:type:Session");
  });
});
