import { create } from "@bufbuild/protobuf";
import {
  TailorDBReplicationDestination_State as DestinationState,
  TailorDBReplicationDestinationSchema,
  TailorDBReplicationSchema,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import {
  mockOperatorClient,
  type OperatorClientMocks,
  withOperatorClientMocks,
} from "#/cli/shared/test-helpers/operator-client";
import { applicationOwner } from "./label";
import { applyTailorDBReplication, planTailorDBReplication } from "./tailordb-replication";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { TailorDBReplication } from "#/parser/service/tailordb-replication/types";
import type { TailorDBReplicationDestination } from "#/types/tailordb-replication.generated";
import type { PlanContext } from "./types";
import type { MessageInitShape } from "@bufbuild/protobuf";

vi.mock("./label", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    buildMetaRequest: vi.fn().mockImplementation(async ({ trn }: { trn: string }) => ({
      trn,
      labels: { "sdk-name": "shop", "sdk-version": "v1-0-0" },
    })),
  };
});

const workspaceId = "test-workspace";

type ExistingReplication = MessageInitShape<typeof TailorDBReplicationSchema> & {
  owner?: string | undefined;
};
type ExistingDestination = MessageInitShape<typeof TailorDBReplicationDestinationSchema> & {
  owner?: string | undefined;
};

const warehouse: TailorDBReplicationDestination = {
  name: "warehouse",
  bigquery: { project: "acme-analytics", dataset: "tailor" },
};

function existingWarehouse(overrides: Partial<ExistingDestination> = {}): ExistingDestination {
  const base: ExistingDestination = {
    name: "warehouse",
    kind: {
      case: "bigquery",
      value: {
        project: "acme-analytics",
        dataset: "tailor",
        serviceAccountEmail: "repl-abc@pool.iam.gserviceaccount.com",
      },
    },
    status: { state: DestinationState.ACTIVE },
  };
  return Object.assign(base, overrides);
}

function replicationOf(overrides: Partial<TailorDBReplication> = {}): TailorDBReplication {
  return {
    name: "analytics",
    source: { namespace: "main-db" },
    destination: "warehouse",
    enabled: true,
    types: [{ name: "User", excludeFields: ["email"] }, { name: "Order" }],
    ...overrides,
  };
}

function existingReplicationOf(overrides: Partial<ExistingReplication> = {}): ExistingReplication {
  const base: ExistingReplication = {
    name: "analytics",
    source: {
      namespace: "main-db",
      types: [
        { name: "Order" },
        { name: "User", fields: { case: "excludeFields", value: { names: ["email"] } } },
      ],
    },
    destination: "warehouse",
    enabled: true,
  };
  return Object.assign(base, overrides);
}

type Remote = {
  destinations?: ExistingDestination[];
  replications?: ExistingReplication[];
};

function createClient<K extends keyof OperatorClient = never>(
  remote: Remote,
  overrides?: OperatorClientMocks<K>,
): OperatorClient {
  const destinations = remote.destinations ?? [];
  const replications = remote.replications ?? [];
  const owners = new Map<string, string | undefined>([
    ...destinations.map((d) => [`tailordb_replication_destination:${d.name}`, d.owner] as const),
    ...replications.map((r) => [`tailordb_replication:${r.name}`, r.owner] as const),
  ]);
  const client = mockOperatorClient({
    listTailorDBReplicationDestinations: {
      destinations: destinations.map(({ owner: _owner, ...d }) =>
        create(TailorDBReplicationDestinationSchema, d),
      ),
      nextPageToken: "",
    },
    listTailorDBReplications: {
      replications: replications.map(({ owner: _owner, ...r }) =>
        create(TailorDBReplicationSchema, r),
      ),
      nextPageToken: "",
    },
    setMetadata: {},
    getMetadata: (request) => {
      const key = request.trn?.split(":").slice(-2).join(":") ?? "";
      const owner = owners.has(key) ? (owners.get(key) ?? "shop") : undefined;
      const labels: Record<string, string> = owner
        ? { "sdk-name": owner, "sdk-version": "v1-0-0" }
        : {};
      return { metadata: { labels } };
    },
  });
  return withOperatorClientMocks(client, overrides);
}

type ContextParams = {
  destinations?: TailorDBReplicationDestination[];
  replications?: TailorDBReplication[];
  forRemoval?: boolean;
};

function contextOf(client: OperatorClient, params: ContextParams = {}): PlanContext {
  const application = {
    name: "shop",
    dbReplicationDestinations: params.destinations ?? [warehouse],
    dbReplications: params.replications ?? [],
  } as unknown as Application;
  return {
    client,
    workspaceId,
    application,
    applications: [],
    owner: applicationOwner(application),
    forRemoval: params.forRemoval ?? false,
    config: { path: "/test/tailor.config.ts" },
  };
}

function tailorDBDeleting(...types: Array<[namespace: string, name: string]>) {
  return {
    changeSet: {
      type: {
        deletes: types.map(([namespaceName, name]) => ({ name, request: { namespaceName } })),
      },
    },
  } as unknown as Parameters<typeof planTailorDBReplication>[1];
}

const noTailorDBDeletes = tailorDBDeleting();

describe("planTailorDBReplication", () => {
  test("creates destinations and replications the workspace lacks", async () => {
    const client = createClient({});
    const plan = await planTailorDBReplication(
      contextOf(client, { replications: [replicationOf({ tablePrefix: "shop_" })] }),
      noTailorDBDeletes,
    );

    expect(plan.changeSet.destination.creates).toEqual([
      expect.objectContaining({
        name: "warehouse",
        request: {
          workspaceId,
          destination: {
            name: "warehouse",
            kind: { case: "bigquery", value: { project: "acme-analytics", dataset: "tailor" } },
          },
        },
      }),
    ]);
    expect(plan.changeSet.replication.creates).toEqual([
      expect.objectContaining({
        name: "analytics",
        request: {
          workspaceId,
          replication: {
            name: "analytics",
            source: {
              namespace: "main-db",
              types: [
                {
                  name: "User",
                  fields: { case: "excludeFields", value: { names: ["email"] } },
                },
                { name: "Order" },
              ],
            },
            destination: "warehouse",
            tablePrefix: "shop_",
            enabled: true,
          },
        },
      }),
    ]);
    expect(plan.writeOrder).toEqual(["analytics"]);
  });

  test("leaves a replication unchanged when only the order of its types differs", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [existingReplicationOf()],
    });
    const plan = await planTailorDBReplication(
      contextOf(client, { replications: [replicationOf()] }),
      noTailorDBDeletes,
    );

    expect(plan.changeSet.replication.unchanged.map(({ name }) => name)).toEqual(["analytics"]);
    expect(plan.changeSet.replication.updates).toEqual([]);
    expect(plan.changeSet.destination.unchanged).toEqual([
      { name: "warehouse", pendingPermission: false },
    ]);
  });

  test("updates a replication the platform disabled so it runs again", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [existingReplicationOf({ enabled: false })],
    });
    const plan = await planTailorDBReplication(
      contextOf(client, { replications: [replicationOf()] }),
      noTailorDBDeletes,
    );

    expect(plan.changeSet.replication.updates.map(({ request }) => request)).toEqual([
      {
        workspaceId,
        replication: expect.objectContaining({ name: "analytics", enabled: true }),
      },
    ]);
  });

  test("replaces a replication whose source namespace changes", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [existingReplicationOf()],
    });
    const plan = await planTailorDBReplication(
      contextOf(client, { replications: [replicationOf({ source: { namespace: "order-db" } })] }),
      noTailorDBDeletes,
    );

    expect(plan.changeSet.replication.replaces).toEqual([
      expect.objectContaining({
        name: "analytics",
        deleteRequest: { workspaceId, name: "analytics" },
      }),
    ]);
    expect(plan.changeSet.replication.updates).toEqual([]);
  });

  test("refuses to move a destination to another dataset", async () => {
    const client = createClient({ destinations: [existingWarehouse()] });

    await expect(
      planTailorDBReplication(
        contextOf(client, {
          destinations: [
            { ...warehouse, bigquery: { project: "acme-analytics", dataset: "lake" } },
          ],
        }),
        noTailorDBDeletes,
      ),
    ).rejects.toMatchObject({ code: "TAILORDB_REPLICATION_DESTINATION_IMMUTABLE" });
  });

  test("detaches the types TailorDB deletes from a kept replication first", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [existingReplicationOf()],
    });
    const plan = await planTailorDBReplication(
      contextOf(client, { replications: [replicationOf({ types: [{ name: "Order" }] })] }),
      tailorDBDeleting(["main-db", "User"], ["other-db", "Order"]),
    );

    expect(plan.detaches).toEqual([
      {
        name: "analytics",
        typeNames: ["User"],
        request: {
          workspaceId,
          replication: expect.objectContaining({
            source: { namespace: "main-db", types: [{ name: "Order" }] },
          }),
        },
      },
    ]);
  });

  test("deletes owned replications but leaves another application's", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [
        existingReplicationOf(),
        existingReplicationOf({ name: "billing", owner: "billing-app", tablePrefix: "b_" }),
      ],
    });
    const plan = await planTailorDBReplication(contextOf(client), noTailorDBDeletes);

    expect(plan.changeSet.replication.deletes.map(({ name }) => name)).toEqual(["analytics"]);
  });

  test("deletes a removed destination early only when no remaining replication uses it", async () => {
    const client = createClient({
      destinations: [
        existingWarehouse(),
        existingWarehouse({
          name: "lake",
          kind: { case: "bigquery", value: { project: "acme-analytics", dataset: "lake" } },
        }),
        existingWarehouse({
          name: "old",
          kind: { case: "bigquery", value: { project: "acme-analytics", dataset: "old" } },
        }),
      ],
      replications: [existingReplicationOf({ destination: "lake" })],
    });
    const plan = await planTailorDBReplication(
      contextOf(client, { replications: [replicationOf()] }),
      noTailorDBDeletes,
    );

    expect(plan.changeSet.destination.deletes.map(({ name }) => name).toSorted()).toEqual([
      "lake",
      "old",
    ]);
    expect([...plan.earlyDestinationDeletes]).toEqual(["old"]);
  });

  test("orders a write after the one that frees its tables", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [
        existingReplicationOf({ name: "first", tablePrefix: "a_" }),
        existingReplicationOf({ name: "second", tablePrefix: "b_" }),
      ],
    });
    const plan = await planTailorDBReplication(
      contextOf(client, {
        replications: [
          replicationOf({ name: "second", tablePrefix: "a_" }),
          replicationOf({ name: "first", tablePrefix: "c_" }),
        ],
      }),
      noTailorDBDeletes,
    );

    expect(plan.writeOrder).toEqual(["first", "second"]);
  });

  test("replaces one of two replications that swap their tables", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [
        existingReplicationOf({ name: "first", tablePrefix: "a_" }),
        existingReplicationOf({ name: "second", tablePrefix: "b_" }),
      ],
    });
    const plan = await planTailorDBReplication(
      contextOf(client, {
        replications: [
          replicationOf({ name: "first", tablePrefix: "B_" }),
          replicationOf({ name: "second", tablePrefix: "a_" }),
        ],
      }),
      noTailorDBDeletes,
    );

    expect(plan.changeSet.replication.replaces.map(({ name }) => name)).toEqual(["second"]);
    expect(plan.changeSet.replication.updates.map(({ name }) => name)).toEqual(["first"]);
    expect(plan.writeOrder).toEqual(["first", "second"]);
  });

  test("rejects writing a table a replication this deploy does not change writes", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [
        existingReplicationOf({ name: "billing", owner: "billing-app", tablePrefix: "a_" }),
      ],
    });

    await expect(
      planTailorDBReplication(
        contextOf(client, { replications: [replicationOf({ tablePrefix: "A_" })] }),
        noTailorDBDeletes,
      ),
    ).rejects.toMatchObject({
      code: "TAILORDB_REPLICATION_TABLE_CONFLICT",
      message: expect.stringContaining(
        '"analytics" would write table "a_user", which "billing" writes',
      ),
    });
  });

  test("rejects deleting a destination another application's replication writes to", async () => {
    const client = createClient({
      destinations: [
        existingWarehouse(),
        existingWarehouse({
          name: "old",
          kind: { case: "bigquery", value: { project: "acme-analytics", dataset: "old" } },
        }),
      ],
      replications: [
        existingReplicationOf({ name: "billing", owner: "billing-app", destination: "old" }),
      ],
    });

    await expect(
      planTailorDBReplication(contextOf(client), noTailorDBDeletes),
    ).rejects.toMatchObject({
      code: "TAILORDB_REPLICATION_IN_USE",
      message: expect.stringContaining(
        '"billing" writes to destination "old", which would be deleted',
      ),
    });
  });

  test("rejects deleting a type another application's replication lists", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [existingReplicationOf({ name: "billing", owner: "billing-app" })],
    });

    await expect(
      planTailorDBReplication(contextOf(client), tailorDBDeleting(["main-db", "User"])),
    ).rejects.toMatchObject({
      code: "TAILORDB_REPLICATION_IN_USE",
      message: expect.stringContaining(
        '"billing" replicates type "main-db/User", which would be deleted',
      ),
    });
  });

  test("renames a destination no replication uses, keeping its dataset", async () => {
    const client = createClient({ destinations: [existingWarehouse()] });
    const plan = await planTailorDBReplication(
      contextOf(client, {
        destinations: [
          { name: "warehouse2", bigquery: { project: "acme-analytics", dataset: "TAILOR" } },
        ],
      }),
      noTailorDBDeletes,
    );

    expect(plan.changeSet.destination.creates.map(({ name }) => name)).toEqual(["warehouse2"]);
    expect([...plan.earlyDestinationDeletes]).toEqual(["warehouse"]);
  });

  test("rejects a new destination on a dataset a kept replication still writes through another destination", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [existingReplicationOf()],
    });
    const warehouse2 = {
      name: "warehouse2",
      bigquery: { project: "acme-analytics", dataset: "tailor" },
    };

    await expect(
      planTailorDBReplication(
        contextOf(client, {
          destinations: [warehouse2],
          replications: [replicationOf({ destination: "warehouse2" })],
        }),
        noTailorDBDeletes,
      ),
    ).rejects.toMatchObject({
      code: "TAILORDB_REPLICATION_DESTINATION_DATASET_IN_USE",
      message: expect.stringContaining(
        '"warehouse2" writes to acme-analytics.tailor, which destination "warehouse" uses until replications "analytics" stop writing to it',
      ),
    });
  });

  test("rejects two types of one replication that map to one table", async () => {
    const client = createClient({ destinations: [existingWarehouse()] });

    await expect(
      planTailorDBReplication(
        contextOf(client, {
          replications: [replicationOf({ types: [{ name: "UserLog" }, { name: "Userlog" }] })],
        }),
        noTailorDBDeletes,
      ),
    ).rejects.toMatchObject({ code: "TAILORDB_REPLICATION_TABLE_CONFLICT" });
  });

  test("plans every owned resource for deletion on removal", async () => {
    const client = createClient({
      destinations: [existingWarehouse()],
      replications: [existingReplicationOf()],
    });
    const plan = await planTailorDBReplication(
      contextOf(client, { forRemoval: true }),
      noTailorDBDeletes,
    );

    expect(plan.changeSet.replication.deletes.map(({ name }) => name)).toEqual(["analytics"]);
    expect([...plan.earlyDestinationDeletes]).toEqual(["warehouse"]);
  });
});

describe("applyTailorDBReplication", () => {
  test("prints the service account to grant when a created destination cannot write yet", async () => {
    const pending = existingWarehouse({
      status: { state: DestinationState.PENDING_PERMISSION, message: "missing dataEditor" },
    });
    const client = createClient(
      {},
      {
        createTailorDBReplicationDestination: { destination: pending },
        getTailorDBReplicationDestination: { destination: pending },
      },
    );
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const log = vi.spyOn(logger, "log").mockImplementation(() => {});
    const plan = await planTailorDBReplication(contextOf(client), noTailorDBDeletes);

    await applyTailorDBReplication(client, plan, "prepare");

    expect(client.createTailorDBReplicationDestination).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Replication destination "warehouse" cannot write to acme-analytics.tailor yet. missing dataEditor',
      ),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("repl-abc@pool.iam.gserviceaccount.com"),
    );
  });

  test("prepares in an order the platform accepts", async () => {
    const calls: string[] = [];
    const lake = existingWarehouse({
      name: "lake",
      kind: { case: "bigquery", value: { project: "acme-analytics", dataset: "lake" } },
    });
    const client = createClient(
      {
        destinations: [
          existingWarehouse(),
          existingWarehouse({
            name: "old",
            kind: { case: "bigquery", value: { project: "acme-analytics", dataset: "old" } },
          }),
        ],
        replications: [
          existingReplicationOf({ name: "gone", destination: "old" }),
          existingReplicationOf(),
        ],
      },
      {
        deleteTailorDBReplication: (request) => {
          calls.push(`delete replication ${request.name}`);
          return {};
        },
        deleteTailorDBReplicationDestination: (request) => {
          calls.push(`delete destination ${request.name}`);
          return {};
        },
        createTailorDBReplicationDestination: (request) => {
          calls.push(`create destination ${request.destination?.name}`);
          return {};
        },
        getTailorDBReplicationDestination: {
          destination: create(TailorDBReplicationDestinationSchema, lake),
        },
        updateTailorDBReplication: (request) => {
          calls.push(`update replication ${request.replication?.name}`);
          return {};
        },
      },
    );
    vi.spyOn(logger, "success").mockImplementation(() => {});
    const plan = await planTailorDBReplication(
      contextOf(client, {
        destinations: [
          warehouse,
          { name: "lake", bigquery: { project: "acme-analytics", dataset: "lake" } },
        ],
        replications: [replicationOf({ types: [{ name: "Order" }] })],
      }),
      tailorDBDeleting(["main-db", "User"]),
    );

    await applyTailorDBReplication(client, plan, "prepare");

    expect(calls).toEqual([
      "delete replication gone",
      "delete destination old",
      "create destination lake",
      "update replication analytics",
    ]);
  });

  test("checks the grant of a destination still waiting for it", async () => {
    const client = createClient(
      {
        destinations: [
          existingWarehouse({ status: { state: DestinationState.PENDING_PERMISSION } }),
        ],
      },
      {
        verifyTailorDBReplicationDestination: { destination: existingWarehouse() },
      },
    );
    const success = vi.spyOn(logger, "success").mockImplementation(() => {});
    const plan = await planTailorDBReplication(contextOf(client), noTailorDBDeletes);

    await applyTailorDBReplication(client, plan, "prepare");

    expect(client.verifyTailorDBReplicationDestination).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, name: "warehouse" }),
    );
    expect(success).toHaveBeenCalledWith(
      'Replication destination "warehouse" can write to acme-analytics.tailor.',
    );
  });

  test("writes replications in the planned order after TailorDB is applied", async () => {
    const calls: string[] = [];
    const client = createClient(
      {
        destinations: [existingWarehouse()],
        replications: [
          existingReplicationOf({ name: "first", tablePrefix: "a_" }),
          existingReplicationOf({ name: "second", tablePrefix: "b_" }),
        ],
      },
      {
        updateTailorDBReplication: (request) => {
          calls.push(request.replication?.name ?? "");
          return {};
        },
      },
    );
    const plan = await planTailorDBReplication(
      contextOf(client, {
        replications: [
          replicationOf({ name: "second", tablePrefix: "a_" }),
          replicationOf({ name: "first", tablePrefix: "c_" }),
        ],
      }),
      noTailorDBDeletes,
    );

    await applyTailorDBReplication(client, plan, "create-update");

    expect(calls).toEqual(["first", "second"]);
  });
});
