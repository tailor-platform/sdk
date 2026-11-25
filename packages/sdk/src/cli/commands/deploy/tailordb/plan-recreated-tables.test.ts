/**
 * A table that the local definitions keep but whose current records must not survive the deploy is
 * planned as a deletion of the remote table plus a creation, instead of an update: one whose
 * deletion an earlier deploy left unfinished, and one that a pending migration removes or renames
 * away.
 */

import { describe, test, expect, vi } from "vitest";
import { SCHEMA_SNAPSHOT_VERSION } from "#/cli/commands/tailordb/migrate/diff-calculator";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import { normalizeSchemaSnapshot } from "#/cli/commands/tailordb/migrate/snapshot";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { validateAndDetectMigrations } from "./migration-validation";
import { mkPendingMigration } from "./test-helpers/migration-apply";
import { planTailorDB } from "./index";
import type { DiffChange } from "#/cli/commands/tailordb/migrate/diff-calculator";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { Application } from "#/cli/services/application";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type * as LabelModule from "../label";

vi.mock("../label", async (importOriginal) => ({
  ...(await importOriginal<typeof LabelModule>()),
  buildMetaRequest: vi.fn().mockImplementation(async () => ({
    trn: "trn:v1:workspace:test-workspace:tailordb:test",
    labels: { "sdk-name": "test-app", "sdk-version": "v1-0-0" },
  })),
}));

vi.mock("./migration-validation", () => ({
  validateAndDetectMigrations: vi.fn(),
  logMigrationPlanNotices: vi.fn(),
}));

const NAMESPACE = "tailordb";
const config = { path: "/test/tailor.config.ts" } as LoadedConfig;

function postTable(withPermission: boolean) {
  return {
    name: "Post",
    pluralForm: "Posts",
    fields: { id: { type: "uuid" as const, required: true } },
    ...(withPermission
      ? {
          permissions: {
            gql: [{ conditions: [], actions: ["read" as const], permit: "allow" as const }],
          },
        }
      : {}),
  };
}

const removePost: DiffChange = {
  kind: "table_removed",
  tableName: "Post",
  before: postTable(false),
};
const addPost: DiffChange = { kind: "table_added", tableName: "Post", after: postTable(false) };

function pending(number: number, changes: DiffChange[]): PendingMigration {
  return mkPendingMigration(changes, { namespace: NAMESPACE, number, hasScript: false });
}

type PlanOptions = {
  withPermission?: boolean;
  pendingMigrations?: PendingMigration[];
  unfinishedRemovals?: string[];
};

function plan(options: PlanOptions) {
  const { withPermission = false } = options;
  vi.mocked(validateAndDetectMigrations).mockResolvedValue({
    namespacesWithMigrations: [],
    migrationFileState: captureMigrationFileState([]),
    checkpointRepairs: [],
    pendingMigrations: options.pendingMigrations ?? [],
    inProgressMigrations: {},
    unfinishedRemovals: options.unfinishedRemovals
      ? new Map([[NAMESPACE, { migrationNumber: 1, tableNames: options.unfinishedRemovals }]])
      : new Map(),
  } as unknown as Awaited<ReturnType<typeof validateAndDetectMigrations>>);
  const client = mockOperatorClient({
    listTailorDBServices: {
      tailordbServices: [{ namespace: { name: NAMESPACE } }],
      nextPageToken: "",
    },
    listTailorDBTypes: { tailordbTypes: [{ name: "Post" }], nextPageToken: "" },
    listTailorDBGQLPermissions: {
      permissions: [{ typeName: "Post", permission: { policies: [] } }],
      nextPageToken: "",
    },
    getMetadata: { metadata: { labels: {} } },
  });
  const service = {
    namespace: NAMESPACE,
    config: {},
    types: {},
    typeSourceInfo: {},
    loadTypes: vi.fn().mockResolvedValue({}),
  } as unknown as TailorDBService;
  const application = {
    name: "test-app",
    env: {},
    tailorDBServices: [service],
    executorService: undefined,
  } as unknown as Application;
  return planTailorDB({
    client,
    workspaceId: "test-workspace",
    application,
    applications: [],
    owner: { kind: "application", name: "test-app", id: undefined },
    forRemoval: false,
    config,
    migrationTestSnapshots: new Map([
      [
        NAMESPACE,
        normalizeSchemaSnapshot({
          version: SCHEMA_SNAPSHOT_VERSION,
          namespace: NAMESPACE,
          createdAt: "2026-01-01T00:00:00.000Z",
          tables: { Post: postTable(withPermission) },
        }),
      ],
    ]),
  });
}

describe("planTailorDB: a table whose deletion is unfinished and that a later migration adds again", () => {
  test("plans a deletion and a creation of the table, not an update", async () => {
    const result = await plan({ unfinishedRemovals: ["Post"] });

    expect(result.changeSet.type.deletes.map((entry) => entry.name)).toEqual(["Post"]);
    expect(result.changeSet.type.creates.map((entry) => entry.name)).toEqual(["Post"]);
    expect(result.changeSet.type.updates).toEqual([]);
    expect(result.changeSet.type.unchanged).toEqual([]);
  });

  test("plans a deletion and a creation of its GraphQL permission", async () => {
    const result = await plan({ withPermission: true, unfinishedRemovals: ["Post"] });

    expect(result.changeSet.gqlPermission.deletes.map((entry) => entry.name)).toEqual(["Post"]);
    expect(result.changeSet.gqlPermission.creates.map((entry) => entry.name)).toEqual(["Post"]);
    expect(result.changeSet.gqlPermission.updates).toEqual([]);
  });
});

describe("planTailorDB: a table the local definitions keep that a pending migration removes", () => {
  test.each([
    { removal: "a removal", removing: removePost },
    {
      removal: "a rename",
      removing: {
        kind: "table_renamed",
        tableName: "Archive",
        previousTableName: "Post",
        before: postTable(false),
        after: { ...postTable(false), name: "Archive", pluralForm: "Archives" },
      } satisfies DiffChange,
    },
  ])(
    "plans a deletion and a creation of the table and its permission after $removal",
    async ({ removing }) => {
      const result = await plan({
        withPermission: true,
        pendingMigrations: [pending(2, [removing]), pending(3, [addPost])],
      });

      expect(result.changeSet.type.deletes.map((entry) => entry.name)).toEqual(["Post"]);
      expect(result.changeSet.type.creates.map((entry) => entry.name)).toEqual(["Post"]);
      expect(result.changeSet.type.updates).toEqual([]);
      expect(result.changeSet.gqlPermission.deletes.map((entry) => entry.name)).toEqual(["Post"]);
      expect(result.changeSet.gqlPermission.creates.map((entry) => entry.name)).toEqual(["Post"]);
    },
  );

  test("plans an update when no pending migration removes the table", async () => {
    const result = await plan({ pendingMigrations: [pending(2, [])] });

    expect(result.changeSet.type.deletes).toEqual([]);
    expect(result.changeSet.type.updates.map((entry) => entry.name)).toEqual(["Post"]);
  });
});
