/**
 * Under --no-schema-check, each pending migration still writes its own snapshot so its script sees
 * the schema it was written for. Local definitions that differ from the last pending migration are
 * applied once every migration has committed, in the same deploy.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { reconstructSnapshotFromMigrations } from "#/cli/commands/tailordb/migrate/snapshot";
import { errorToJson } from "#/cli/shared/error-json";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
import * as migrationModule from "./migration";
import {
  createPlanResult,
  createRemoteCheckpoint,
  mkPendingMigration,
  mockConfig,
  type RemoteCheckpoint,
  snapshotAt,
  snapshotTable,
  type SnapshotTablesByVersion,
  tailordbTypeWrites,
  typeEntry,
  typeMetaRequest,
} from "./test-helpers/migration-apply";
import { applyTailorDB, type MaintenanceModeRelease } from "./index";
import type { DiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { TailorDBSnapshotType } from "#/cli/commands/tailordb/migrate/snapshot";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";

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

const user = snapshotTable("User", { name: { type: "string", required: true } });
const userWithNickname = snapshotTable("User", {
  name: { type: "string", required: true },
  nickname: { type: "string", required: false },
});
const post = snapshotTable("Post", { title: { type: "string", required: true } });
const localPost = snapshotTable("Post", {
  title: { type: "string", required: true },
  body: { type: "string", required: false },
});

const restricted = {
  publishRecordEvents: false,
  disableGqlOperations: { create: true, update: true, delete: true, read: false },
};

describe("migration flow: local definitions that no pending migration includes", () => {
  let checkpoint: RemoteCheckpoint;

  function createMockClient(existingTableNames = ["User", "Post"]): OperatorClient {
    return checkpoint.createMockClient({
      listTailorDBTypes: vi.fn(async () => ({
        tailordbTypes: existingTableNames.map((name) => ({
          name,
          schema: { settings: { bulkUpsert: false, publishRecordEvents: false } },
        })),
      })),
    });
  }

  function createMockPlanResult(options: {
    local: TailorDBSnapshotType[];
    creates?: string[];
    updates?: string[];
    unchanged?: string[];
    maintenanceMode?: LoadedConfig["maintenanceMode"];
  }) {
    return createPlanResult({
      type: {
        creates: (options.creates ?? []).map((name) => typeEntry(name)),
        updates: (options.updates ?? []).map((name) => typeEntry(name)),
        unchanged: (options.unchanged ?? []).map((name) => ({
          name,
          metaRequest: typeMetaRequest(name),
        })),
      },
      local: options.local,
      context: {
        config: {
          ...mockConfig,
          maintenanceMode: "maintenanceMode" in options ? options.maintenanceMode : "migration",
        },
      },
    });
  }

  function mockPending(changes: DiffChange[]) {
    checkpoint.mockPending([mkPendingMigration(changes, { hasScript: false })]);
  }

  const addNickname = {
    kind: "field_added",
    tableName: "User",
    fieldName: "nickname",
    after: { type: "string", required: false },
  } as DiffChange;

  function writesOf(client: OperatorClient, tableName: string) {
    return tailordbTypeWrites(client).filter((write) => write.name === tableName);
  }

  function fieldNames(write: ReturnType<typeof writesOf>[number] | undefined) {
    return Object.keys(write?.tailordbType.schema?.fields ?? {}).toSorted();
  }

  function lastLabelOrder() {
    return Math.max(...vi.mocked(migrationModule.updateMigrationLabel).mock.invocationCallOrder);
  }

  beforeEach(() => {
    snapshotState.tablesByVersion = {
      0: { User: user, Post: post },
      1: { User: userWithNickname, Post: post },
    };
    checkpoint = createRemoteCheckpoint(0);
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(checkpoint.record);
    vi.mocked(reconstructSnapshotFromMigrations).mockImplementation((_migrationsDir, maxVersion) =>
      snapshotAt(snapshotState.tablesByVersion, maxVersion),
    );
  });

  test.each(["updates", "unchanged"] as const)(
    "applies the local definition of a table the plan lists under %s once the migrations commit",
    async (bucket) => {
      using stderr = captureStderr();
      const client = createMockClient();
      mockPending([addNickname]);
      const planResult = createMockPlanResult({
        local: [userWithNickname, localPost],
        updates: bucket === "updates" ? ["User", "Post"] : ["User"],
        unchanged: bucket === "unchanged" ? ["Post"] : [],
      });

      await applyTailorDB(client, planResult, "create-update");

      const postWrites = writesOf(client, "Post");
      expect(fieldNames(postWrites.at(-1))).toEqual(["body", "title"]);
      expect(postWrites.at(-1)?.tailordbType.schema?.settings).toEqual(
        expect.objectContaining({ publishRecordEvents: false, disableGqlOperations: undefined }),
      );
      const localWrites = postWrites.filter((write) => fieldNames(write).includes("body"));
      for (const write of localWrites) expect(write.order).toBeGreaterThan(lastLabelOrder());
      expect(fieldNames(writesOf(client, "User").at(-1))).toEqual(["name", "nickname"]);
      expect(stderr.output).toContain(
        "Applied local definitions that migration test-ns/0001 does not include, after the pending migrations: Post.",
      );
    },
  );

  test("applies the local definition unrestricted with maintenance mode off", async () => {
    const client = createMockClient();
    mockPending([addNickname]);
    const planResult = createMockPlanResult({
      local: [userWithNickname, localPost],
      updates: ["User", "Post"],
      maintenanceMode: false,
    });

    await applyTailorDB(client, planResult, "create-update");

    const postWrites = writesOf(client, "Post");
    expect(fieldNames(postWrites.at(-1))).toEqual(["body", "title"]);
    for (const write of postWrites) {
      expect(write.tailordbType.schema?.settings?.disableGqlOperations).toBeUndefined();
    }
  });

  test('"deploy" keeps the local definition restricted until the held release lifts it', async () => {
    const client = createMockClient();
    mockPending([addNickname]);
    const planResult = createMockPlanResult({
      local: [userWithNickname, localPost],
      updates: ["User", "Post"],
      maintenanceMode: "deploy",
    });

    const releases: MaintenanceModeRelease[] = [];
    await applyTailorDB(client, planResult, "create-update", {
      holdMaintenanceMode: (release) => releases.push(release),
    });

    const held = writesOf(client, "Post").at(-1);
    expect(fieldNames(held)).toEqual(["body", "title"]);
    expect(held?.tailordbType.schema?.settings).toEqual(expect.objectContaining(restricted));

    await releases[0]?.(client);

    const released = writesOf(client, "Post").at(-1);
    expect(fieldNames(released)).toEqual(["body", "title"]);
    expect(released?.tailordbType.schema?.settings?.disableGqlOperations).toBeUndefined();
  });

  test("fails after the migrations commit when a local definition cannot be applied", async () => {
    const client = createMockClient();
    vi.mocked(client.updateTailorDBType).mockImplementation(async (request) => {
      if (request.tailordbType?.schema?.fields?.body) throw new Error("rows lack body");
      return {} as never;
    });
    mockPending([addNickname]);
    const planResult = createMockPlanResult({
      local: [userWithNickname, localPost],
      updates: ["User", "Post"],
    });

    const error = await applyTailorDB(client, planResult, "create-update").catch(
      (failure: unknown) => failure,
    );

    expect(error).toMatchObject({ message: "rows lack body" });
    expect(errorToJson(error).error).toMatchObject({
      code: "MIGRATION_LOCAL_DEFINITIONS_FAILED",
      suggestion: expect.stringMatching(
        /run `tailor tailordb migration generate --namespace test-ns --config=\S*\/test\/tailor\.config\.ts` to add it/,
      ),
      context: { namespace: "test-ns", table: "Post", created: [] },
    });
    expect(checkpoint.state.number).toBe(1);
    const last = writesOf(client, "Post").at(-1);
    expect(fieldNames(last)).toEqual(["title"]);
    expect(last?.tailordbType.schema?.settings?.disableGqlOperations).toBeUndefined();
  });

  test("names the tables it already created when a later local definition fails", async () => {
    const client = createMockClient();
    vi.mocked(client.updateTailorDBType).mockImplementation(async (request) => {
      if (request.tailordbType?.schema?.fields?.body) throw new Error("rows lack body");
      return {} as never;
    });
    mockPending([addNickname]);
    const tag = snapshotTable("Tag", { label: { type: "string", required: true } });
    const planResult = createMockPlanResult({
      local: [userWithNickname, localPost, tag],
      creates: ["Tag"],
      updates: ["User", "Post"],
    });

    const error = await applyTailorDB(client, planResult, "create-update").catch(
      (failure: unknown) => failure,
    );

    expect(errorToJson(error).error).toMatchObject({
      code: "MIGRATION_LOCAL_DEFINITIONS_FAILED",
      suggestion: expect.stringContaining(
        "Tables created for their local definitions remain: namespace 'test-ns': Tag.",
      ),
      context: { table: "Post", created: [{ namespace: "test-ns", tables: ["Tag"] }] },
    });
  });

  test("creates a table absent from every snapshot before updating the tables that may refer to it", async () => {
    const client = createMockClient();
    mockPending([addNickname]);
    const tag = snapshotTable("Tag", { label: { type: "string", required: true } });
    const planResult = createMockPlanResult({
      local: [userWithNickname, localPost, tag],
      creates: ["Tag"],
      updates: ["User", "Post"],
    });

    await applyTailorDB(client, planResult, "create-update");

    const tagCreates = vi
      .mocked(client.createTailorDBType)
      .mock.calls.filter((call) => call[0].tailordbType?.name === "Tag");
    expect(tagCreates).toHaveLength(1);
    const tagOrder = writesOf(client, "Tag")[0]?.order;
    const firstLocalPost = writesOf(client, "Post").find((write) =>
      fieldNames(write).includes("body"),
    );
    expect(tagOrder).toBeGreaterThan(lastLabelOrder());
    expect(tagOrder).toBeLessThan(firstLocalPost?.order ?? 0);
  });

  test("creates a checkpoint table a pending migration removes but the local definition keeps", async () => {
    const draft = snapshotTable("Draft", { name: { type: "string", required: true } });
    snapshotState.tablesByVersion = {
      0: { User: user, Post: post, Draft: draft },
      1: { User: user, Post: post },
    };
    const client = createMockClient(["User", "Post"]);
    mockPending([{ kind: "table_removed", tableName: "Draft" } as DiffChange]);
    const planResult = createMockPlanResult({
      local: [user, post, draft],
      creates: ["Draft"],
      unchanged: ["User", "Post"],
    });

    await applyTailorDB(client, planResult, "create-update");

    const draftWrites = writesOf(client, "Draft");
    expect(draftWrites).toHaveLength(1);
    expect(draftWrites[0]?.order).toBeGreaterThan(lastLabelOrder());
  });

  test("applies the local definition of a table a pending migration creates", async () => {
    const order = snapshotTable("Order", { status: { type: "string", required: true } });
    const localOrder = snapshotTable("Order", {
      status: { type: "string", required: true },
      note: { type: "string", required: false },
    });
    snapshotState.tablesByVersion = {
      0: { User: user, Post: post },
      1: { User: user, Post: post, Order: order },
    };
    const client = createMockClient();
    mockPending([{ kind: "table_added", tableName: "Order" } as DiffChange]);
    const planResult = createMockPlanResult({
      local: [user, post, localOrder],
      creates: ["Order"],
      unchanged: ["User", "Post"],
    });

    await applyTailorDB(client, planResult, "create-update");

    const orderCreates = vi
      .mocked(client.createTailorDBType)
      .mock.calls.filter((call) => call[0].tailordbType?.name === "Order");
    expect(orderCreates).toHaveLength(1);
    expect(fieldNames(writesOf(client, "Order").at(-1))).toEqual(["note", "status"]);
  });

  test("applies and releases the local definition of a table a pending migration creates and a later one removes", async () => {
    const temp = snapshotTable("Temp", { value: { type: "string", required: true } });
    const localTemp = snapshotTable("Temp", {
      value: { type: "string", required: true },
      note: { type: "string", required: false },
    });
    snapshotState.tablesByVersion = {
      0: { User: user, Post: post },
      1: { User: user, Post: post, Temp: temp },
      2: { User: user, Post: post },
    };
    const client = createMockClient();
    checkpoint.mockPending([
      mkPendingMigration([{ kind: "table_added", tableName: "Temp" } as DiffChange], {
        hasScript: false,
      }),
      mkPendingMigration([{ kind: "table_removed", tableName: "Temp" } as DiffChange], {
        number: 2,
        hasScript: false,
      }),
    ]);
    const planResult = createMockPlanResult({
      local: [user, post, localTemp],
      creates: ["Temp"],
      unchanged: ["User", "Post"],
    });

    await applyTailorDB(client, planResult, "create-update");

    expect(
      vi
        .mocked(client.createTailorDBType)
        .mock.calls.filter((call) => call[0].tailordbType?.name === "Temp"),
    ).toHaveLength(1);
    const last = writesOf(client, "Temp").at(-1);
    expect(fieldNames(last)).toEqual(["note", "value"]);
    expect(last?.tailordbType.schema?.settings?.disableGqlOperations).toBeUndefined();
  });

  test("does not apply local definitions when the checkpoint advanced concurrently", async () => {
    const client = createMockClient();
    vi.mocked(migrationModule.updateMigrationLabel).mockImplementation(async (...args) => {
      await checkpoint.record(...args);
      checkpoint.state.number = 2;
      return true;
    });
    mockPending([addNickname]);
    const planResult = createMockPlanResult({
      local: [userWithNickname, localPost],
      updates: ["User", "Post"],
    });

    await expect(applyTailorDB(client, planResult, "create-update")).rejects.toThrow(
      /advanced concurrently/,
    );

    expect(writesOf(client, "Post").some((write) => fieldNames(write).includes("body"))).toBe(
      false,
    );
  });

  test("writes nothing more when the local definitions match the last pending migration", async () => {
    using stderr = captureStderr();
    const client = createMockClient();
    mockPending([addNickname]);
    const planResult = createMockPlanResult({
      local: [userWithNickname, post],
      updates: ["User"],
      unchanged: ["Post"],
    });

    await applyTailorDB(client, planResult, "create-update");

    expect(stderr.output).not.toContain("Applied local definitions");
    expect(fieldNames(writesOf(client, "Post").at(-1))).toEqual(["title"]);
  });
});
