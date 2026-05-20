/**
 * Reproduction test for SDK migration bulk-schema-deploy bug.
 *
 * Bug:
 *   `executeSingleMigrationPrePhase` (in `./index.ts`) sends the FINAL schema
 *   (= `changeSet.type.updates[].request.tailordbType`) for any type that is
 *   "affected" by the current migration. Because `changeSet` is computed from
 *   local types (post-all-migrations), the FINAL schema already reflects
 *   removals/changes from LATER migrations.
 *
 *   This means: when an early migration's prePhase touches a type T, any field
 *   that LATER migrations remove from T is dropped during that early prePhase.
 *   If an intermediate migration's data script reads such a field, it fails at
 *   runtime with `field 'X' not found`.
 *
 * Per-migration phases (per docs `services/tailordb-migration.md` §"Per-migration phases"):
 *   - Pre-migration: "Type changes that would be breaking are applied in a relaxed form first.
 *                     Non-breaking changes that are part of the same migration are also applied here."
 *   - Script execution
 *   - Post-migration: "Required constraints are enforced; field/type deletions are applied"
 *
 * Expected behavior (per docs):
 *   Migration N's prePhase should only apply N's own changes. Removals from migration M>N
 *   should be deferred to migration M's postPhase.
 *
 * Actual behavior (this test verifies):
 *   Migration N's prePhase sends the FINAL schema for any affected type, so removals
 *   from later migrations are applied during N's prePhase.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { applyTailorDB } from "./index";
import type { PendingMigration } from "@/cli/commands/tailordb/migrate/types";
import type { Application } from "@/cli/services/application";
import type { TailorDBService } from "@/cli/services/tailordb/service";
import type { OperatorClient } from "@/cli/shared/client";
import type { LoadedConfig } from "@/cli/shared/config-loader";

// Mock label.ts to suppress real metadata building
vi.mock("../label", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("../label");
  return {
    ...original,
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:tailordb:test-ns",
      labels: {},
    }),
  };
});

// Mock createChangeSet to suppress output in tests
vi.mock("../change-set", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("../change-set");
  return {
    ...original,
    createChangeSet: (title: string) => ({
      ...original.createChangeSet(title),
      print: () => {},
    }),
  };
});

// Mock the migration helpers so applyTailorDB enters the migration flow without
// touching the filesystem or the remote workspace.
vi.mock("./migration", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./migration");
  return {
    ...original,
    detectPendingMigrations: vi.fn(),
    executeMigrations: vi.fn().mockResolvedValue(undefined),
    updateMigrationLabel: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock migration config / snapshot helpers (called inside validateAndDetectMigrations)
vi.mock("@/cli/commands/tailordb/migrate/config", () => ({
  getNamespacesWithMigrations: vi.fn().mockReturnValue([
    {
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
    },
  ]),
}));

// Per-migration schema snapshots that `executeSingleMigration{Pre,Post}Phase`
// derive via `reconstructSnapshotFromMigrations(migrationsDir, migration.number)`.
//
// Migration 1 captures the state AFTER #1 (adds `permissions`, still has `roles`).
// Migration 5 captures the state AFTER #5 (removes `roles`).
const snapshotFixtures = vi.hoisted(() => {
  const buildUser = (
    fields: Record<string, { type: string; required: boolean; array?: boolean }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any => ({
    name: "User",
    pluralForm: "users",
    fields,
  });

  const userAfterMigration1 = buildUser({
    name: { type: "string", required: true },
    permissions: { type: "string", required: false, array: true },
    roles: { type: "string", required: true, array: true },
  });

  const userAfterMigration5 = buildUser({
    name: { type: "string", required: true },
    permissions: { type: "string", required: false, array: true },
  });

  const baseSnapshot =
    (typesByMigration: Record<number, unknown>) => (migrationsDir: string, maxVersion?: number) => {
      void migrationsDir;
      const number = maxVersion ?? 0;
      const types = typesByMigration[number];
      if (!types) {
        throw new Error(`No snapshot fixture configured for migration number: ${number}`);
      }
      return {
        version: 1 as const,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        types,
      };
    };

  return {
    reconstructSnapshotFromMigrations: baseSnapshot({
      1: { User: userAfterMigration1 },
      5: { User: userAfterMigration5 },
    }),
  };
});

vi.mock("@/cli/commands/tailordb/migrate/snapshot", async (importOriginal) => {
  const original =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    (await importOriginal()) as typeof import("@/cli/commands/tailordb/migrate/snapshot");
  return {
    ...original,
    assertValidMigrationFiles: vi.fn(),
    reconstructSnapshotFromMigrations: vi.fn(snapshotFixtures.reconstructSnapshotFromMigrations),
  };
});

import * as migrationModule from "./migration";

const mockConfig = { path: "/test/tailor.config.ts" } as LoadedConfig;

describe("bug repro: bulk schema deploy in per-migration prePhase", () => {
  function createMockClient() {
    return {
      createTailorDBService: vi.fn().mockResolvedValue({}),
      setMetadata: vi.fn().mockResolvedValue({}),
      createTailorDBType: vi.fn().mockResolvedValue({}),
      updateTailorDBType: vi.fn().mockResolvedValue({}),
      createTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      updateTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBGQLPermission: vi.fn().mockResolvedValue({}),
      deleteTailorDBType: vi.fn().mockResolvedValue({}),
      deleteTailorDBService: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;
  }

  /**
   * Construct a minimal plan result with:
   *   - changeSet.type.updates contains User with FINAL schema (no `roles`, has `permissions`)
   *   - No type creates / deletes / services / gql permissions
   *
   * The pending migrations we inject via mock are:
   *   - migration 1: adds User.permissions field (affects User)
   *   - migration 5: removes User.roles field (affects User)
   *
   * Both `requiresMigrationScript: false` for simplicity. The bug is in prePhase, not script.
   * @returns Mock `PlanResults["tailorDB"]` used by `applyTailorDB`.
   */
  function createMockPlanResult() {
    const mockService = {
      namespace: "test-ns",
      loadTypes: vi.fn().mockResolvedValue({}),
      types: {},
    } as unknown as TailorDBService;

    // The FINAL User schema (= post-all-migrations) — DOES NOT contain `roles`
    const finalUserTypeRequest = {
      workspaceId: "test-workspace",
      namespaceName: "test-ns",
      tailordbType: {
        name: "User",
        schema: {
          fields: [
            { name: "id", type: "uuid", required: true },
            { name: "name", type: "string", required: true },
            { name: "permissions", type: "string", required: false, array: true },
            // NOTE: no `roles` field — already removed in the local source-of-truth
          ],
        },
      },
    };

    return {
      changeSet: {
        service: {
          creates: [],
          updates: [],
          deletes: [],
          title: "TailorDB Services",
          isEmpty: () => true,
          print: () => {},
        },
        type: {
          creates: [],
          updates: [
            {
              name: "User",
              request: finalUserTypeRequest,
            },
          ],
          deletes: [],
          title: "TailorDB Types",
          isEmpty: () => false,
          print: () => {},
        },
        gqlPermission: {
          creates: [],
          updates: [],
          deletes: [],
          title: "TailorDB GQL Permissions",
          isEmpty: () => true,
          print: () => {},
        },
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
      context: {
        workspaceId: "test-workspace",
        application: {
          name: "test-app",
          tailorDBServices: [mockService],
          authService: undefined,
        } as unknown as Application,
        tailorDBInputs: [],
        executorUsedTypes: new Set<string>(),
        config: mockConfig,
        noSchemaCheck: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  /**
   * Build a pending migration with the given number and a single `field_added` change.
   * affectedTypes = { typeName } per the migration's diff.changes.
   * @param number - Migration number used for path generation
   * @param typeName - The TailorDB type affected by the migration
   * @param fieldName - The field added in this migration
   * @returns A mock pending migration that adds `fieldName` to `typeName`.
   */
  function mkAddFieldMigration(
    number: number,
    typeName: string,
    fieldName: string,
  ): PendingMigration {
    return {
      number,
      scriptPath: `/test/migrations/${String(number).padStart(4, "0")}/migrate.ts`,
      diffPath: `/test/migrations/${String(number).padStart(4, "0")}/diff.json`,
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
      diff: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_added",
            typeName,
            fieldName,
            after: { type: "string", required: false, array: true },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  /**
   * Build a pending migration with the given number and a single `field_removed` change.
   * @param number - Migration number used for path generation
   * @param typeName - The TailorDB type affected by the migration
   * @param fieldName - The field removed in this migration
   * @returns A mock pending migration that removes `fieldName` from `typeName`.
   */
  function mkRemoveFieldMigration(
    number: number,
    typeName: string,
    fieldName: string,
  ): PendingMigration {
    return {
      number,
      scriptPath: `/test/migrations/${String(number).padStart(4, "0")}/migrate.ts`,
      diffPath: `/test/migrations/${String(number).padStart(4, "0")}/diff.json`,
      namespace: "test-ns",
      migrationsDir: "/test/migrations",
      diff: {
        version: 1,
        namespace: "test-ns",
        createdAt: new Date().toISOString(),
        changes: [
          {
            kind: "field_removed",
            typeName,
            fieldName,
            before: { type: "string", required: true, array: true },
          },
        ],
        hasBreakingChanges: false,
        breakingChanges: [],
        requiresMigrationScript: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("per-migration semantics: migration #1 prePhase must NOT apply removals declared in later migration #5", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    // Two pending migrations:
    //   #1: adds User.permissions (affects User)
    //   #5: removes User.roles (affects User)
    //
    // Per `services/tailordb-migration.md` §"Per-migration phases":
    //   - Pre-migration: only the *current* migration's non-breaking changes are applied
    //   - Post-migration: field/type deletions are applied
    //
    // Therefore, when migration #1's prePhase updates User, the request sent
    // to the platform MUST still contain the `roles` field (because #5's
    // removal belongs to #5's postPhase, not #1's prePhase).
    //
    // This test fails on the current implementation because
    // `executeSingleMigrationPrePhase` sends `changeSet.type.updates[].request`
    // verbatim — that request is built from the local source-of-truth types
    // (post-all-migrations), so `roles` has already been dropped from it.
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkAddFieldMigration(1, "User", "permissions"),
      mkRemoveFieldMigration(5, "User", "roles"),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    // First call corresponds to migration #1 prePhase (User is in affectedTypes for #1)
    const firstCall = updateCalls[0];
    expect(firstCall).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sentSchema = (firstCall![0] as any)?.tailordbType?.schema;
    expect(sentSchema).toBeDefined();

    // `generateTailorDBTypeManifest` produces `fields` as a Record keyed by
    // field name (id is implicit and excluded), so inspect Object.keys.
    const fieldNames = Object.keys(sentSchema.fields ?? {});

    // Sanity: the new field from #1 must be present
    expect(fieldNames).toContain("permissions");
    expect(fieldNames).toContain("name");

    // Spec assertion: `roles` must still exist at #1 prePhase time, because
    // its removal is owned by migration #5's postPhase. (FAILS on current impl)
    expect(fieldNames).toContain("roles");
  });

  test("verification: only User-affecting migrations trigger updateTailorDBType for User", async () => {
    const client = createMockClient();
    const planResult = createMockPlanResult();

    // Single migration that does NOT affect User
    vi.mocked(migrationModule.detectPendingMigrations).mockResolvedValue([
      mkAddFieldMigration(1, "SomeOtherType", "foo"),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    // User is in changeSet.type.updates, but the only migration affects
    // SomeOtherType (which isn't even in the changeSet). updateTailorDBType
    // should NOT have been called for User.
    const updateCalls = vi.mocked(client.updateTailorDBType).mock.calls;
    const userUpdates = updateCalls.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c) => (c[0] as any)?.tailordbType?.name === "User",
    );
    expect(userUpdates).toHaveLength(0);
  });
});
