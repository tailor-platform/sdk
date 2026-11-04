/**
 * TailorDB apply runs after staticWebsite apply in the same deploy pass, so a
 * site this deploy just created already exists by the time a migration script
 * executes -- even though `application.env` was resolved earlier, at build
 * time, before that site existed. `buildMigrationContextForScripts` must
 * re-resolve `env` right before building the migration context, the same way
 * cors/OAuth2/IdP values are re-resolved right before their own apply calls.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
  mkPendingMigration,
  type RemoteCheckpoint,
  typeEntry,
} from "./test-helpers/migration-apply";
import { applyTailorDB } from "./index";
import type { DiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
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

describe("applyTailorDB: env static website URL resolution for migration scripts", () => {
  let checkpoint: RemoteCheckpoint;

  function createMockClient() {
    return checkpoint.createMockClient({
      getStaticWebsite: vi.fn().mockResolvedValue({
        staticwebsite: { url: "https://my-site.tailor.tech" },
      }),
    });
  }

  function buildPlanResult(applicationEnv: Application["env"]) {
    return createPlanResult({
      type: {
        creates: [
          typeEntry("StockReservation", { fields: { id: { type: "uuid", required: true } } }),
        ],
      },
      application: { env: applicationEnv },
    });
  }

  function mkAddTypeMigration(): PendingMigration {
    return mkPendingMigration([
      { kind: "table_added", tableName: "StockReservation" } as unknown as DiffChange,
    ]);
  }

  beforeEach(() => {
    checkpoint = createRemoteCheckpoint(0);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
  });

  test("re-resolves an env static website placeholder before executing the migration script", async () => {
    const client = createMockClient();
    const planResult = buildPlanResult({ siteUrl: "my-site:url" });
    checkpoint.mockPending([mkAddTypeMigration()]);

    await applyTailorDB(client, planResult, "create-update");

    expect(client.getStaticWebsite).toHaveBeenCalledWith({
      workspaceId: "test-workspace",
      name: "my-site",
    });
    expect(migrationModule.executeMigrations).toHaveBeenCalledTimes(1);
    const [context] = vi.mocked(migrationModule.executeMigrations).mock.calls[0]!;
    expect(context.env).toEqual({ siteUrl: "https://my-site.tailor.tech" });
  });

  test("leaves env untouched, with no platform lookup, when it holds no placeholder", async () => {
    const client = createMockClient();
    const planResult = buildPlanResult({ plain: "value" });
    checkpoint.mockPending([mkAddTypeMigration()]);

    await applyTailorDB(client, planResult, "create-update");

    expect(client.getStaticWebsite).not.toHaveBeenCalled();
    const [context] = vi.mocked(migrationModule.executeMigrations).mock.calls[0]!;
    expect(context.env).toEqual({ plain: "value" });
  });
});
