/**
 * Within a migrating namespace, the per-migration phases only materialize
 * types named by some pending diff (plus types whose GQL permission forces a
 * fallback create). Planned creates of types that already exist in the schema
 * state before the namespace's first pending migration — the whole baseline
 * on a fresh-workspace replay, and every table when the pending migration is
 * data-only — must still be created, from that snapshot's schema, before any
 * migration script runs.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { reconstructSnapshotFromMigrations } from "#/cli/commands/tailordb/migrate/snapshot";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
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

// Per-test schema states keyed by migration number, so reconstruction returns
// the state as of the requested checkpoint like the real replay does.
const snapshotState = { tablesByVersion: {} as SnapshotTablesByVersion };

describe("migration flow: creates of types predating the pending migrations", () => {
  function createMockPlanResult(options: {
    creates: string[];
    updates?: string[];
    gqlPermissionTypes?: string[];
  }) {
    return createPlanResult({
      type: {
        creates: options.creates.map((name) => typeEntry(name)),
        updates: (options.updates ?? []).map((name) => typeEntry(name)),
      },
      gqlPermission: {
        creates: (options.gqlPermissionTypes ?? []).map((name) => gqlPermissionEntry(name)),
      },
    });
  }

  function createdTypeCalls(client: OperatorClient) {
    return vi.mocked(client.createTailorDBType).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = call[0] as any;
      return `${request.namespaceName}/${request.tailordbType?.name}`;
    });
  }

  function createOrderOf(client: OperatorClient, tableName: string) {
    const index = vi
      .mocked(client.createTailorDBType)
      .mock.calls.findIndex(
        (call) =>
          (call[0] as { tailordbType?: { name?: string } }).tailordbType?.name === tableName,
      );
    return vi.mocked(client.createTailorDBType).mock.invocationCallOrder[index];
  }

  function firstScriptOrder() {
    return vi.mocked(migrationModule.executeMigrations).mock.invocationCallOrder[0];
  }

  let checkpoint: RemoteCheckpoint;

  beforeEach(() => {
    snapshotState.tablesByVersion = {};
    checkpoint = createRemoteCheckpoint(null);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
    vi.mocked(reconstructSnapshotFromMigrations).mockImplementation((_migrationsDir, maxVersion) =>
      snapshotAt(snapshotState.tablesByVersion, maxVersion),
    );
  });

  test("creates a baseline type no pending diff names, from its snapshot, before the script", async () => {
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult({
      creates: ["User", "Audit"],
      updates: ["Metrics"],
      gqlPermissionTypes: ["User"],
    });
    snapshotState.tablesByVersion = {
      0: { Audit: snapshotTable("Audit", { legacy: { type: "string", required: false } }) },
      1: {
        Audit: snapshotTable("Audit", { legacy: { type: "string", required: false } }),
        User: snapshotTable("User", { name: { type: "string", required: true } }),
      },
    };
    checkpoint.mockPending([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "User" } as any]),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    expect(createdTypeCalls(client)).toContain("test-ns/Audit");
    expect(createOrderOf(client, "Audit")).toBeLessThan(firstScriptOrder()!);

    // The create is built from the checkpoint snapshot, not the final schema.
    const auditRequest = vi
      .mocked(client.createTailorDBType)
      .mock.calls.map(
        (call) => call[0] as { tailordbType?: { name?: string; schema?: { fields?: object } } },
      )
      .find((request) => request.tailordbType?.name === "Audit");
    expect(Object.keys(auditRequest?.tailordbType?.schema?.fields ?? {})).toContain("legacy");

    // Updates of types no pending diff names stay skipped: the final schema
    // must not be enforced outside the per-migration phases.
    const updatedTypes = vi.mocked(client.updateTailorDBType).mock.calls.map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = call[0] as any;
      return `${request.namespaceName}/${request.tailordbType?.name}`;
    });
    expect(updatedTypes).not.toContain("test-ns/Metrics");
  });

  test("data-only migration: every baseline type is created exactly once before the script", async () => {
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult({
      creates: ["User", "Audit"],
      gqlPermissionTypes: ["User"],
    });
    const baseline = {
      User: snapshotTable("User", { name: { type: "string", required: true } }),
      Audit: snapshotTable("Audit", { legacy: { type: "string", required: false } }),
    };
    snapshotState.tablesByVersion = { 0: baseline, 1: baseline };
    checkpoint.mockPending([mkPendingMigration([])]);

    await applyTailorDB(client, planResult, "create-update");

    const created = createdTypeCalls(client);
    expect(created).toContain("test-ns/Audit");
    expect(created.filter((name) => name === "test-ns/User")).toHaveLength(1);

    const lastCreateOrder = Math.max(
      ...vi.mocked(client.createTailorDBType).mock.invocationCallOrder,
    );
    expect(lastCreateOrder).toBeLessThan(firstScriptOrder()!);
  });

  test("creates a baseline type a later migration modifies before the earlier script", async () => {
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult({ creates: ["User"] });
    const baselineUser = snapshotTable("User", { name: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: { User: baselineUser },
      1: { User: baselineUser },
      2: {
        User: snapshotTable("User", {
          name: { type: "string", required: true },
          nickname: { type: "string", required: false },
        }),
      },
    };
    checkpoint.mockPending([
      mkPendingMigration([]),
      mkPendingMigration(
        [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {
            kind: "field_added",
            tableName: "User",
            fieldName: "nickname",
            after: { type: "string", required: false },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
        { number: 2, hasScript: false },
      ),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const created = createdTypeCalls(client);
    expect(created.filter((name) => name === "test-ns/User")).toHaveLength(1);
    expect(createOrderOf(client, "User")).toBeLessThan(firstScriptOrder()!);
  });

  test("does not pre-create a type that a later pending migration adds", async () => {
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult({ creates: ["Report", "Audit"] });
    const audit = snapshotTable("Audit", { legacy: { type: "string", required: false } });
    snapshotState.tablesByVersion = {
      0: { Audit: audit },
      1: { Audit: audit },
      2: {
        Audit: audit,
        Report: snapshotTable("Report", { name: { type: "string", required: true } }),
      },
    };
    checkpoint.mockPending([
      mkPendingMigration([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "Report" } as any], {
        number: 2,
        hasScript: false,
      }),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    const created = createdTypeCalls(client);
    expect(created.filter((name) => name === "test-ns/Report")).toHaveLength(1);
    expect(created).toContain("test-ns/Audit");
    expect(createOrderOf(client, "Report")).toBeGreaterThan(firstScriptOrder()!);
    expect(createOrderOf(client, "Audit")).toBeLessThan(firstScriptOrder()!);
  });

  test("does not pre-create a baseline type a pending migration removes and re-adds", async () => {
    const client = checkpoint.createMockClient();
    const planResult = createMockPlanResult({ creates: ["Draft", "Audit"] });
    const audit = snapshotTable("Audit", { legacy: { type: "string", required: false } });
    const draft = snapshotTable("Draft", { name: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: { Audit: audit, Draft: draft },
      1: { Audit: audit, Draft: draft },
      2: { Audit: audit },
      3: { Audit: audit, Draft: draft },
    };
    checkpoint.mockPending([
      mkPendingMigration([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_removed", tableName: "Draft" } as any], {
        number: 2,
        hasScript: false,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mkPendingMigration([{ kind: "table_added", tableName: "Draft" } as any], {
        number: 3,
        hasScript: false,
      }),
    ]);

    await applyTailorDB(client, planResult, "create-update");

    // Pre-creating Draft would erase the remove→add boundary: with no delete
    // entry in the plan, the removal's post phase would drop nothing and rows
    // written before the removal would survive it.
    const created = createdTypeCalls(client);
    expect(created.filter((name) => name === "test-ns/Draft")).toHaveLength(1);
    expect(createOrderOf(client, "Draft")).toBeGreaterThan(firstScriptOrder()!);
    expect(createOrderOf(client, "Audit")).toBeLessThan(firstScriptOrder()!);
  });
});
