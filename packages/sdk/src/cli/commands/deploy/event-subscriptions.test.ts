import { describe, expect, test } from "vitest";
import {
  assertRecordableDependencies,
  collectDependentApps,
  collectEventSubscriptions,
} from "./deploy";

type TargetSpec = {
  configPath: string;
  appId?: string;
  namespace?: string;
  types?: string[];
  resolvers?: string[];
  idps?: string[];
  workflows?: string[];
  /** Workflows that declare `publishEvents`, pinning the value. */
  pinnedWorkflows?: string[];
  /** TailorDB types that declare `publishEvents`, pinning the value. */
  pinnedTypes?: string[];
  externalTailorDBNamespaces?: string[];
  externalResolverNamespaces?: string[];
  externalIdps?: string[];
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
          // settings is a required field on TailorDBType, so the fixture carries it.
          types: Object.fromEntries(
            (spec.types ?? []).map((name) => [
              name,
              {
                name,
                settings: (spec.pinnedTypes ?? []).includes(name) ? { publishEvents: true } : {},
              },
            ]),
          ),
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
        workflows: Object.fromEntries(
          (spec.workflows ?? []).map((name) => [
            name,
            (spec.pinnedWorkflows ?? []).includes(name) ? { name, publishEvents: true } : { name },
          ]),
        ),
      },
      externalTailorDBNamespaces: spec.externalTailorDBNamespaces ?? [],
      // Mirrors defineTailorDB/defineResolver/defineIdp: only these contribute a
      // subgraph, so a workflow-only config has none and gets no application.
      subgraphs: [
        ...((spec.types ?? []).length ? [{ Type: "tailordb", Name: `db${suffix}` }] : []),
        ...((spec.resolvers ?? []).length ? [{ Type: "pipeline", Name: `pipeline${suffix}` }] : []),
        ...(spec.idps ?? []).map((Name) => ({ Type: "idp", Name })),
        ...(spec.externalResolverNamespaces ?? []).map((Name) => ({ Type: "pipeline", Name })),
        ...(spec.externalIdps ?? []).map((Name) => ({ Type: "idp", Name })),
      ],
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
      kind: "TailorDB type",
      trigger: { kind: "tailordb", typeName: "Order" },
      external: { externalTailorDBNamespaces: ["shared-db"] },
      expected:
        'declares external TailorDB namespace "shared-db", so add the config that owns it to --config',
    },
    {
      kind: "Resolver",
      trigger: { kind: "resolverExecuted", resolverName: "processOrder" },
      external: { externalResolverNamespaces: ["shared-pipeline"] },
      expected:
        'declares external resolver namespace "shared-pipeline", so add the config that owns it to --config',
    },
    {
      kind: "IdP service",
      trigger: { kind: "idpUser", idp: "shared-idp" },
      external: { externalIdps: ["shared-idp"] },
      expected: 'declares external IdP "shared-idp", so add the config that owns it to --config',
    },
  ])(
    "points at the missing peer config when the resource is declared external ($kind)",
    ({ trigger, external, expected }) => {
      expect(() =>
        collectEventSubscriptions([
          target({
            configPath: "buyer/tailor.config.ts",
            ...external,
            executors: { "sync-it": trigger },
          }),
        ]),
      ).toThrow(expected);
    },
  );

  test("points at the name when the config declares nothing external", () => {
    expect(() =>
      collectEventSubscriptions([
        target({
          configPath: "buyer/tailor.config.ts",
          executors: { "sync-order": { kind: "tailordb", typeName: "Odrer" } },
        }),
      ]),
    ).toThrow("declares nothing external that could hold it, so check the name");
  });

  test("does not point at an unrelated external IdP", () => {
    expect(() =>
      collectEventSubscriptions([
        target({
          configPath: "buyer/tailor.config.ts",
          externalIdps: ["other-idp"],
          executors: { "sync-user": { kind: "idpUser", idp: "shared-idp" } },
        }),
      ]),
    ).toThrow("declares nothing external that could hold it, so check the name");
  });

  test.each([{ kind: "workflowExecution" }, { kind: "workflowJobExecution" }])(
    "says a workflow cannot be declared external ($kind)",
    ({ kind }) => {
      expect(() =>
        collectEventSubscriptions([
          target({
            configPath: "buyer/tailor.config.ts",
            externalTailorDBNamespaces: ["shared-db"],
            executors: { "sync-orders": { kind, workflowName: "orders" } },
          }),
        ]),
      ).toThrow('A workflow has no "external" declaration');
    },
  );

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
      sees: { externalResolverNamespaces: ["pipeline"] },
    },
    {
      kind: "idpUser",
      trigger: { kind: "idpUser", idp: "shared-idp" },
      owns: { idps: ["shared-idp"] },
      sees: { externalIdps: ["shared-idp"] },
    },
    {
      kind: "workflowExecution",
      trigger: { kind: "workflowExecution", workflowName: "orders" },
      owns: { workflows: ["orders"] },
    },
  ])(
    "resolves a cross-config subscription to the declaring config ($kind)",
    ({ trigger, owns, sees }) => {
      const owner = target({ configPath: "supplier/tailor.config.ts", appId: supplierId, ...owns });
      const subscriber = target({
        configPath: "buyer/tailor.config.ts",
        appId: "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b82",
        executors: { "sync-it": trigger },
        ...sees,
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
        externalTailorDBNamespaces: ["db-supplier", "db-vendor"],
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

describe("assertRecordableDependencies", () => {
  const dependentId = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b82";

  test("rejects a cross-config subscription to a config that gets no application", () => {
    // A workflow is the one publishing resource that contributes no subgraph, so
    // a workflow-only config has no application to carry the record.
    const subscriptions = collectEventSubscriptions([
      target({ configPath: "runner/tailor.config.ts", workflows: ["nightly"] }),
      target({
        configPath: "buyer/tailor.config.ts",
        appId: dependentId,
        types: ["Order"],
        executors: {
          "watch-nightly": { kind: "workflowExecution", workflowName: "nightly" },
        },
      }),
    ]);

    expect(() => assertRecordableDependencies(subscriptions, true)).toThrow(
      /no application to record the dependency on/,
    );
    expect(() => assertRecordableDependencies(subscriptions, true)).toThrow(
      /Declare "publishEvents" on Workflow "nightly"/,
    );
  });

  test("accepts the same subscription once the owning config contributes a subgraph", () => {
    const subscriptions = collectEventSubscriptions([
      target({ configPath: "runner/tailor.config.ts", types: ["Run"], workflows: ["nightly"] }),
      target({
        configPath: "buyer/tailor.config.ts",
        appId: dependentId,
        namespace: "buyer",
        executors: {
          "watch-nightly": { kind: "workflowExecution", workflowName: "nightly" },
        },
      }),
    ]);

    expect(() => assertRecordableDependencies(subscriptions, true)).not.toThrow();
  });

  test("accepts a subscription the owning config declares itself", () => {
    // Nothing is recorded for a same-config subscription, so the absence of an
    // application does not matter.
    const subscriptions = collectEventSubscriptions([
      target({
        configPath: "runner/tailor.config.ts",
        workflows: ["nightly"],
        executors: {
          "watch-nightly": { kind: "workflowExecution", workflowName: "nightly" },
        },
      }),
    ]);

    expect(() => assertRecordableDependencies(subscriptions, true)).not.toThrow();
  });
});

describe("assertRecordableDependencies id requirement", () => {
  // A config that re-exports defineConfig() from another file never gets an id,
  // on any path, so the record could not name which config depends on the owner.
  const idless = () => [
    target({ configPath: "supplier/tailor.config.ts", types: ["Order"] }),
    target({
      configPath: "wrapper/tailor.config.ts",
      namespace: "wrapper",
      externalTailorDBNamespaces: ["db"],
      executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
    }),
  ];

  test("rejects a cross-config subscriber that resolves without an id", () => {
    expect(() => assertRecordableDependencies(collectEventSubscriptions(idless()), true)).toThrow(
      /resolves without an "id"/,
    );
  });

  test("accepts it on a run that only reports, where no id is injected yet", () => {
    expect(() =>
      assertRecordableDependencies(collectEventSubscriptions(idless()), false),
    ).not.toThrow();
  });

  test("accepts a same-config subscription from an id-less config", () => {
    const subscriptions = collectEventSubscriptions([
      target({
        configPath: "wrapper/tailor.config.ts",
        types: ["Order"],
        executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
      }),
    ]);

    expect(() => assertRecordableDependencies(subscriptions, true)).not.toThrow();
  });
});

describe("assertRecordableDependencies escape hatch", () => {
  // The messages tell the reader to declare publishEvents. Rejecting the
  // subscription anyway would leave them with an error they cannot clear.
  function subscriptionsTo(pinned: boolean) {
    return collectEventSubscriptions([
      target({
        configPath: "runner/tailor.config.ts",
        workflows: ["nightly"],
        pinnedWorkflows: pinned ? ["nightly"] : [],
      }),
      target({
        configPath: "buyer/tailor.config.ts",
        appId: "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b82",
        types: ["Order"],
        executors: { "watch-nightly": { kind: "workflowExecution", workflowName: "nightly" } },
      }),
    ]);
  }

  test("accepts the subscription once the workflow declares publishEvents", () => {
    expect(() => assertRecordableDependencies(subscriptionsTo(true), true)).not.toThrow();
  });

  test("still rejects it while the workflow leaves the value unset", () => {
    expect(() => assertRecordableDependencies(subscriptionsTo(false), true)).toThrow(
      /no application to record the dependency on/,
    );
  });

  test("accepts an id-less subscriber whose subscribed TailorDB type pins the value", () => {
    const subscriptions = collectEventSubscriptions([
      target({ configPath: "supplier/tailor.config.ts", types: ["Order"], pinnedTypes: ["Order"] }),
      target({
        configPath: "wrapper/tailor.config.ts",
        namespace: "wrapper",
        externalTailorDBNamespaces: ["db"],
        executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
      }),
    ]);

    expect(() => assertRecordableDependencies(subscriptions, true)).not.toThrow();
  });

  test("accepts an id-less subscriber when the owner pins the value", () => {
    const subscriptions = collectEventSubscriptions([
      target({
        configPath: "supplier/tailor.config.ts",
        workflows: ["nightly"],
        pinnedWorkflows: ["nightly"],
        types: ["Order"],
      }),
      target({
        configPath: "wrapper/tailor.config.ts",
        namespace: "wrapper",
        executors: { "watch-nightly": { kind: "workflowExecution", workflowName: "nightly" } },
      }),
    ]);

    expect(() => assertRecordableDependencies(subscriptions, true)).not.toThrow();
  });
});

describe("collectDependentApps and a declared publishEvents", () => {
  test("records nothing when the subscribed resource declares the value", () => {
    // Recording it would ask about a partial deploy that changes nothing, and
    // prompt.confirm rejects where it cannot ask — failing a safe deploy in CI.
    const subscriptions = collectEventSubscriptions([
      target({ configPath: "supplier/tailor.config.ts", types: ["Order"], pinnedTypes: ["Order"] }),
      target({
        configPath: "buyer/tailor.config.ts",
        appId: "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b82",
        namespace: "buyer",
        externalTailorDBNamespaces: ["db"],
        executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
      }),
    ]);

    expect(collectDependentApps(subscriptions)).toEqual(new Map());
  });
});

describe("collectEventSubscriptions and namespace visibility", () => {
  // The executor resolves a cross-config type through the namespaces its config
  // can see, so matching on the bare name would call this ambiguous and drop a
  // subscription the executor resolves to exactly one owner.
  const peersSharingATypeName = [
    target({ configPath: "supplier/tailor.config.ts", namespace: "supplier", types: ["Order"] }),
    target({ configPath: "vendor/tailor.config.ts", namespace: "vendor", types: ["Order"] }),
  ];

  test("resolves the owner the subscriber's own namespaces single out", () => {
    const subscriptions = collectEventSubscriptions([
      ...peersSharingATypeName,
      target({
        configPath: "shell/tailor.config.ts",
        externalTailorDBNamespaces: ["db-vendor"],
        executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
      }),
    ]);

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.owner.config.path).toBe("vendor/tailor.config.ts");
  });

  test("reports a resource no namespace the subscriber sees declares", () => {
    expect(() =>
      collectEventSubscriptions([
        ...peersSharingATypeName,
        target({
          configPath: "shell/tailor.config.ts",
          executors: { "sync-order": { kind: "tailordb", typeName: "Order" } },
        }),
      ]),
    ).toThrow(/which no config in this deploy declares/);
  });
});
