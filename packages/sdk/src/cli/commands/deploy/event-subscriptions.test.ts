import { describe, expect, test } from "vitest";
import { collectDependentApps, collectEventSubscriptions } from "./deploy";

type TargetSpec = {
  configPath: string;
  appId?: string;
  namespace?: string;
  types?: string[];
  resolvers?: string[];
  idps?: string[];
  workflows?: string[];
  executors?: Record<string, Record<string, unknown>>;
};

type Target = Parameters<typeof collectEventSubscriptions>[0][number];

function target(spec: TargetSpec): Target {
  const suffix = spec.namespace === undefined ? "" : `-${spec.namespace}`;
  return {
    config: { path: spec.configPath },
    application: {
      id: spec.appId,
      name: spec.configPath.split("/")[0],
      tailorDBServices: [
        {
          namespace: `db${suffix}`,
          types: Object.fromEntries((spec.types ?? []).map((name) => [name, { name }])),
        },
      ],
      resolverServices: [
        {
          namespace: `pipeline${suffix}`,
          resolvers: Object.fromEntries((spec.resolvers ?? []).map((name) => [name, { name }])),
        },
      ],
      idpServices: (spec.idps ?? []).map((name) => ({ name })),
      workflowService: {
        workflows: Object.fromEntries((spec.workflows ?? []).map((name) => [name, { name }])),
      },
      subgraphs: [],
      executorService: {
        executors: Object.fromEntries(
          Object.entries(spec.executors ?? {}).map(([name, trigger]) => [
            `/${name}.ts`,
            { name, trigger },
          ]),
        ),
      },
    },
  } as unknown as Target;
}

const supplierId = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81";

describe("collectEventSubscriptions", () => {
  test.each([
    {
      kind: "tailordb",
      trigger: { kind: "tailordb", typeName: "Order" },
      owns: { types: ["Order"] },
    },
    {
      kind: "resolverExecuted",
      trigger: { kind: "resolverExecuted", resolverName: "processOrder" },
      owns: { resolvers: ["processOrder"] },
    },
    {
      kind: "idpUser",
      trigger: { kind: "idpUser", idp: "shared-idp" },
      owns: { idps: ["shared-idp"] },
    },
    {
      kind: "workflowExecution",
      trigger: { kind: "workflowExecution", workflowName: "orders" },
      owns: { workflows: ["orders"] },
    },
    {
      kind: "workflowJobExecution",
      trigger: { kind: "workflowJobExecution", workflowName: "orders" },
      owns: { workflows: ["orders"] },
    },
  ])("throws when no config in the run declares the subscribed resource ($kind)", ({ trigger }) => {
    expect(() =>
      collectEventSubscriptions([
        target({ configPath: "buyer/tailor.config.ts", executors: { "sync-it": trigger } }),
      ]),
    ).toThrow(/which no config in this deploy declares/);
  });

  test.each([
    {
      kind: "tailordb",
      trigger: { kind: "tailordb", typeName: "Order" },
      owns: { types: ["Order"] },
    },
    {
      kind: "resolverExecuted",
      trigger: { kind: "resolverExecuted", resolverName: "processOrder" },
      owns: { resolvers: ["processOrder"] },
    },
    {
      kind: "idpUser",
      trigger: { kind: "idpUser", idp: "shared-idp" },
      owns: { idps: ["shared-idp"] },
    },
    {
      kind: "workflowExecution",
      trigger: { kind: "workflowExecution", workflowName: "orders" },
      owns: { workflows: ["orders"] },
    },
  ])(
    "resolves a cross-config subscription to the declaring config ($kind)",
    ({ trigger, owns }) => {
      const owner = target({ configPath: "supplier/tailor.config.ts", appId: supplierId, ...owns });
      const subscriber = target({
        configPath: "buyer/tailor.config.ts",
        appId: "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b82",
        executors: { "sync-it": trigger },
      });

      const subscriptions = collectEventSubscriptions([owner, subscriber]);

      expect(subscriptions).toHaveLength(1);
      expect(subscriptions[0]?.owner.config.path).toBe("supplier/tailor.config.ts");
      expect(subscriptions[0]?.subscriber.config.path).toBe("buyer/tailor.config.ts");
    },
  );

  test("resolves a same-config subscription to the subscriber itself", () => {
    const only = target({
      configPath: "buyer/tailor.config.ts",
      appId: supplierId,
      types: ["Order"],
      executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
    });

    const subscriptions = collectEventSubscriptions([only]);

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.owner.config.path).toBe("buyer/tailor.config.ts");
  });

  test("prefers the subscriber's own declaration over a peer reusing the name", () => {
    const peer = target({
      configPath: "supplier/tailor.config.ts",
      namespace: "supplier",
      types: ["Order"],
    });
    const subscriber = target({
      configPath: "buyer/tailor.config.ts",
      namespace: "buyer",
      types: ["Order"],
      executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
    });

    for (const targets of [
      [peer, subscriber],
      [subscriber, peer],
    ]) {
      const subscriptions = collectEventSubscriptions(targets);
      expect(subscriptions[0]?.owner.config.path).toBe("buyer/tailor.config.ts");
    }
  });

  test("skips a name several peers declare in different namespaces", () => {
    const subscriptions = collectEventSubscriptions([
      target({ configPath: "supplier/tailor.config.ts", namespace: "supplier", types: ["Order"] }),
      target({ configPath: "vendor/tailor.config.ts", namespace: "vendor", types: ["Order"] }),
      target({
        configPath: "shell/tailor.config.ts",
        executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
      }),
    ]);

    expect(subscriptions).toEqual([]);
  });

  test("ignores triggers that name no publishing resource", () => {
    expect(
      collectEventSubscriptions([
        target({
          configPath: "buyer/tailor.config.ts",
          executors: { nightly: { kind: "schedule" } },
        }),
      ]),
    ).toEqual([]);
  });
});

describe("collectDependentApps", () => {
  const owner = target({
    configPath: "supplier/tailor.config.ts",
    appId: supplierId,
    types: ["Order"],
  });
  const buyerId = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b82";

  test("records the subscribing config when it is not the owner", () => {
    const subscriptions = collectEventSubscriptions([
      owner,
      target({
        configPath: "buyer/tailor.config.ts",
        appId: buyerId,
        executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
      }),
    ]);

    expect(collectDependentApps(subscriptions)).toEqual(new Map([[buyerId, "publish-events"]]));
  });

  test("records nothing when the subscriber owns the resource", () => {
    const subscriptions = collectEventSubscriptions([
      target({
        configPath: "supplier/tailor.config.ts",
        appId: supplierId,
        types: ["Order"],
        executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
      }),
    ]);

    expect(collectDependentApps(subscriptions)).toEqual(new Map());
  });

  test("records nothing when the subscribing config has no application id", () => {
    const subscriptions = collectEventSubscriptions([
      owner,
      target({
        configPath: "buyer/tailor.config.ts",
        executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
      }),
    ]);

    expect(collectDependentApps(subscriptions)).toEqual(new Map());
  });
});
