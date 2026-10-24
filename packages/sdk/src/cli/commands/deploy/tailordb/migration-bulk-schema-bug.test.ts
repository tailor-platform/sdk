/**
 * Per-migration prePhase must submit the schema state as of that migration,
 * not the FINAL (post-all-migrations) schema. Removals declared in migration
 * M must not leak into the prePhase of any earlier migration N (N < M);
 * deletions are owned by M's postPhase only.
 *
 * See `services/tailordb/migration.md` §"Per-migration phases".
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
  typeEntry,
} from "./test-helpers/migration-apply";
import { applyTailorDB } from "./index";
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

const buildType = (
  name: string,
  pluralForm: string,
  fields: Record<string, { type: string; required: boolean; array?: boolean }>,
) => ({ name, pluralForm, fields });

const buildUser = (fields: Record<string, { type: string; required: boolean; array?: boolean }>) =>
  buildType("User", "users", fields);

const tablesByMigration = {
  0: {},
  1: {
    SalesOrder: buildType("SalesOrder", "salesOrders", {
      status: { type: "string", required: false },
      reference: { type: "string", required: false },
    }),
    User: buildUser({
      name: { type: "string", required: true },
      permissions: { type: "string", required: false, array: true },
      roles: { type: "string", required: true, array: true },
    }),
  },
  5: {
    User: buildUser({
      name: { type: "string", required: true },
      permissions: { type: "string", required: false, array: true },
    }),
  },
};

describe("per-migration prePhase: schema is scoped to migration[N]", () => {
  function createMockPlanResult() {
    return createPlanResult({
      type: {
        updates: [
          typeEntry("User", {
            fields: {
              id: { type: "uuid", required: true },
              name: { type: "string", required: true },
              permissions: { type: "string", required: false, array: true },
            },
          }),
        ],
      },
      application: { authService: undefined },
    });
  }

  function setPendingMigrations(migrations: PendingMigration[]): void {
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue(migrations);
  }

  function mkFieldMigration(
    kind: "field_added" | "field_removed",
    number: number,
    tableName: string,
    fieldName: string,
  ): PendingMigration {
    const fieldSpec = { type: "string", array: true };
    const change =
      kind === "field_added"
        ? { kind, tableName, fieldName, after: { ...fieldSpec, required: false } }
        : { kind, tableName, fieldName, before: { ...fieldSpec, required: true } };
    return mkPendingMigration([change], { number, hasScript: false });
  }

  let checkpoint: RemoteCheckpoint;

  beforeEach(() => {
    checkpoint = createRemoteCheckpoint(null);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
    vi.mocked(reconstructSnapshotFromMigrations).mockImplementation((_migrationsDir, maxVersion) =>
      snapshotAt(tablesByMigration, maxVersion),
    );
  });

  test("per-migration semantics: migration #1 prePhase must NOT apply removals declared in later migration #5", async () => {
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult();

    setPendingMigrations([
      mkFieldMigration("field_added", 1, "User", "permissions"),
      mkFieldMigration("field_removed", 5, "User", "roles"),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    const firstCall = updateCalls[0];
    expect(firstCall).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sentSchema = (firstCall![0] as any)?.tailordbType?.schema;
    expect(sentSchema).toBeDefined();

    // `fields` is a Record keyed by field name (id is implicit and excluded).
    const fieldNames = Object.keys(sentSchema.fields ?? {});

    expect(fieldNames).toContain("permissions");
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("roles");
  });

  test("verification: only User-affecting migrations trigger updateTailorDBType for User", async () => {
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult();

    setPendingMigrations([mkFieldMigration("field_added", 1, "SomeOtherType", "foo")]);

    await applyTailorDB(client, planResult, "create-update");

    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    const userUpdates = updateCalls.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c) => (c[0] as any)?.tailordbType?.name === "User",
    );
    expect(userUpdates).toHaveLength(0);
  });

  test("creates migration prePhase tables sequentially", async () => {
    const createStarts: string[] = [];
    let firstCreateStarted!: () => void;
    let releaseFirstCreate!: () => void;
    const firstCreateStartedPromise = new Promise<void>((resolve) => {
      firstCreateStarted = resolve;
    });
    const firstCreateReleasePromise = new Promise<void>((resolve) => {
      releaseFirstCreate = resolve;
    });

    const client = checkpoint.createMockClient();
    vi.mocked(client.createTailorDBType).mockImplementation(async (request) => {
      const tableName = request.tailordbType?.name ?? "unknown";
      createStarts.push(tableName);
      if (tableName === "SalesOrder") {
        firstCreateStarted();
        await firstCreateReleasePromise;
      }
      return {} as Awaited<ReturnType<typeof client.createTailorDBType>>;
    });

    const planResult = createPlanResult({
      type: {
        creates: [typeEntry("SalesOrder", { fields: {} }), typeEntry("User", { fields: {} })],
      },
      application: { authService: undefined },
    });

    const migration = mkFieldMigration("field_added", 1, "SalesOrder", "reference");
    migration.diff.changes = [
      {
        kind: "field_added",
        tableName: "SalesOrder",
        fieldName: "reference",
        after: { type: "string", required: false },
      },
      {
        kind: "field_added",
        tableName: "User",
        fieldName: "permissions",
        after: { type: "string", required: false, array: true },
      },
    ];
    setPendingMigrations([migration]);

    const applyPromise = applyTailorDB(client, planResult, "create-update");
    await firstCreateStartedPromise;
    await Promise.resolve();

    expect(createStarts).toEqual(["SalesOrder"]);

    releaseFirstCreate();
    await applyPromise;
    expect(createStarts).toEqual(["SalesOrder", "User"]);
  });
});
