/**
 * A table whose deletion an earlier deploy left unfinished, and that a later migration adds
 * again, is planned as a deletion of the remote table plus a creation, so the table starts over
 * instead of the plan updating the leftover.
 */

import { describe, test, expect, vi } from "vitest";
import { SCHEMA_SNAPSHOT_VERSION } from "#/cli/commands/tailordb/migrate/diff-calculator";
import { captureMigrationFileState } from "#/cli/commands/tailordb/migrate/file-state";
import { normalizeSchemaSnapshot } from "#/cli/commands/tailordb/migrate/snapshot";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { validateAndDetectMigrations } from "./migration-validation";
import { planTailorDB } from "./index";
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

function plan({ withPermission }: { withPermission: boolean }) {
  vi.mocked(validateAndDetectMigrations).mockResolvedValue({
    namespacesWithMigrations: [],
    migrationFileState: captureMigrationFileState([]),
    checkpointRepairs: [],
    pendingMigrations: [],
    inProgressMigrations: {},
    unfinishedRemovals: new Map([[NAMESPACE, { migrationNumber: 1, tableNames: ["Post"] }]]),
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
    const result = await plan({ withPermission: false });

    expect(result.changeSet.type.deletes.map((entry) => entry.name)).toEqual(["Post"]);
    expect(result.changeSet.type.creates.map((entry) => entry.name)).toEqual(["Post"]);
    expect(result.changeSet.type.updates).toEqual([]);
    expect(result.changeSet.type.unchanged).toEqual([]);
  });

  test("plans a deletion and a creation of its GraphQL permission", async () => {
    const result = await plan({ withPermission: true });

    expect(result.changeSet.gqlPermission.deletes.map((entry) => entry.name)).toEqual(["Post"]);
    expect(result.changeSet.gqlPermission.creates.map((entry) => entry.name)).toEqual(["Post"]);
    expect(result.changeSet.gqlPermission.updates).toEqual([]);
  });
});
