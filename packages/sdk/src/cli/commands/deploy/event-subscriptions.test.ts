import { describe, expect, test } from "vitest";
import {
  assertRecordableDependencies,
  collectDependentApps,
  collectEventSubscriptions,
} from "./event-subscriptions";

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
  /** Job names each workflow runs, keyed by workflow name. */
  jobsByWorkflow?: Record<string, string[]>;
  /** Jobs that declare `publishEvents`, pinning the jobs' value. */
  declaredJobs?: string[];
  /** TailorDB tables that declare `publishEvents`, pinning the value. */
  pinnedTypes?: string[];
  /**
   * A second resolver namespace on this config, listed before the one `resolvers`
   * builds. Resolver names are only namespace-unique, so this is how a config
   * holds the same name twice.
   */
  extraResolverNamespace?: { namespace: string; resolvers: string[]; pinned?: string[] };
  externalTailorDBNamespaces?: string[];
  externalResolverNamespaces?: string[];
  externalIdps?: string[];
  executors?: Record<string, Record<string, unknown>>;
  /** Executors declared with `disabled: true`, keyed the same way as `executors`. */
  disabledExecutors?: Record<string, Record<string, unknown>>;
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
        ...(spec.extraResolverNamespace
          ? [
              {
                namespace: spec.extraResolverNamespace.namespace,
                resolvers: Object.fromEntries(
                  spec.extraResolverNamespace.resolvers.map((name) => [
                    name,
                    {
                      name,
                      ...(spec.extraResolverNamespace?.pinned?.includes(name)
                        ? { publishEvents: true }
                        : {}),
                    },
                  ]),
                ),
              },
            ]
          : []),
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
            {
              name,
              mainJob: { name: `${name}-main` },
              ...((spec.pinnedWorkflows ?? []).includes(name) ? { publishEvents: true } : {}),
            },
          ]),
        ),
        jobs: Object.values(spec.jobsByWorkflow ?? {})
          .flat()
          .map((name) => ({
            name,
            ...((spec.declaredJobs ?? []).includes(name) ? { publishEvents: true } : {}),
          })),
      },
      externalTailorDBNamespaces: spec.externalTailorDBNamespaces ?? [],
      // Mirrors defineTailorDB/defineResolver/defineIdp: only these contribute a
      // subgraph, so a workflow-only config has none and gets no application.
      subgraphs: [
        ...((spec.types ?? []).length ? [{ Type: "tailordb", Name: `db${suffix}` }] : []),
        ...((spec.resolvers ?? []).length ? [{ Type: "pipeline", Name: `pipeline${suffix}` }] : []),
        ...(spec.extraResolverNamespace
          ? [{ Type: "pipeline", Name: spec.extraResolverNamespace.namespace }]
          : []),
        ...(spec.idps ?? []).map((Name) => ({ Type: "idp", Name })),
        ...(spec.externalResolverNamespaces ?? []).map((Name) => ({ Type: "pipeline", Name })),
        ...(spec.externalIdps ?? []).map((Name) => ({ Type: "idp", Name })),
      ],
      executorService: {
        executors: Object.fromEntries([
          ...Object.entries(spec.executors ?? {}).map(([name, trigger]) => [
            `/${name}.ts`,
            { name, trigger },
          ]),
          ...Object.entries(spec.disabledExecutors ?? {}).map(([name, trigger]) => [
            `/${name}.ts`,
            { name, trigger, disabled: true },
          ]),
        ]),
      },
    },
    workflowBuildResult: {
      mainJobDeps: Object.fromEntries(
        Object.entries(spec.jobsByWorkflow ?? {}).map(([workflowName, jobNames]) => [
          `${workflowName}-main`,
          jobNames,
        ]),
      ),
    },
  } as unknown as Target;
}

const supplierId = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81";

describe("collectEventSubscriptions", () => {
  test.each([
    {
      kind: "tailordb",
      trigger: { kind: "tailordb", tableName: "Order" },
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
      kind: "TailorDB table",
      trigger: { kind: "tailordb", tableName: "Order" },
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
          executors: { "sync-order": { kind: "tailordb", tableName: "Odrer" } },
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

  test("names the jobs, not the workflow, for a job execution subscription", () => {
    // The trigger subscribes to the jobs' events, so naming the workflow would
    // read as if its own publishEvents were at stake.
    expect(() =>
      collectEventSubscriptions([
        target({
          configPath: "buyer/tailor.config.ts",
          executors: {
            "sync-jobs": { kind: "workflowJobExecution", workflowName: "orders" },
          },
        }),
      ]),
    ).toThrow('Jobs of workflow "orders"');
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
      trigger: { kind: "tailordb", tableName: "Order" },
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
      executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
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
      executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
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
        executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
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

  test("keys the record by the subscribed resource, not by the owning application", () => {
    // The record lives on the resource whose publishEvents is at stake, so it
    // survives the owner being renamed and goes away with the resource.
    const subscriptions = collectEventSubscriptions([
      owner,
      target({
        configPath: "buyer/tailor.config.ts",
        appId: buyerId,
        namespace: "buyer",
        externalTailorDBNamespaces: ["db"],
        executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
      }),
    ]);

    expect(collectDependentApps(subscriptions)).toEqual(
      new Map([["tailordb:db:type:Order", new Map([[buyerId, "publish-events"]])]]),
    );
  });

  test("records nothing when the subscriber owns the resource", () => {
    const subscriptions = collectEventSubscriptions([
      target({
        configPath: "supplier/tailor.config.ts",
        appId: supplierId,
        types: ["Order"],
        executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
      }),
    ]);

    expect(collectDependentApps(subscriptions)).toEqual(new Map());
  });

  test("records nothing when the subscribing config has no application id", () => {
    const subscriptions = collectEventSubscriptions([
      owner,
      target({
        configPath: "buyer/tailor.config.ts",
        executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
      }),
    ]);

    expect(collectDependentApps(subscriptions)).toEqual(new Map());
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
      executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
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
        executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
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
        executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
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
        executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
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
          executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
        }),
      ]),
    ).toThrow(/which no config in this deploy declares/);
  });
});

describe("collectEventSubscriptions and the two values a workflow carries", () => {
  // The workflow's own execution events and the ones its jobs publish are driven
  // by different triggers, so one key for both lets a subscriber of one answer for
  // the other and suppress the confirmation.
  function keysFor(kind: "workflowExecution" | "workflowJobExecution") {
    return collectEventSubscriptions([
      target({ configPath: "runner/tailor.config.ts", workflows: ["nightly"] }),
      target({
        configPath: "buyer/tailor.config.ts",
        appId: "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b82",
        types: ["Order"],
        executors: { "watch-nightly": { kind, workflowName: "nightly" } },
      }),
    ]).map((subscription) => subscription.key);
  }

  test("keys a workflowExecution subscription by the workflow", () => {
    expect(keysFor("workflowExecution")).toEqual(["workflow:nightly"]);
  });

  test("keys a workflowJobExecution subscription separately from the workflow", () => {
    expect(keysFor("workflowJobExecution")).toEqual(["workflow:nightly:jobs"]);
  });
});

describe("collectEventSubscriptions and which jobs settle a workflow's jobs value", () => {
  // planWorkflow decides a workflow's job records from the jobs that workflow
  // runs, so reading the whole config's jobs here would disagree with what it
  // writes: another workflow's unset job would make the value look recomputed.
  const runner = target({
    configPath: "runner/tailor.config.ts",
    types: ["Report"],
    workflows: ["nightly", "other"],
    jobsByWorkflow: { nightly: ["send-report"], other: ["archive"] },
    declaredJobs: ["send-report"],
  });
  const idlessSubscriber = target({
    configPath: "buyer/tailor.config.ts",
    types: ["Order"],
    executors: {
      "watch-jobs": { kind: "workflowJobExecution", workflowName: "nightly" },
    },
  });

  test("treats the jobs as declared when the subscribed workflow declares all of its own", () => {
    const subscriptions = collectEventSubscriptions([runner, idlessSubscriber]);

    expect(subscriptions.map((subscription) => subscription.pinned)).toEqual([true]);
    // A declared value needs no record, so the absent id is not a problem.
    expect(() => assertRecordableDependencies(subscriptions, true)).not.toThrow();
    expect(collectDependentApps(subscriptions).size).toBe(0);
  });

  test("treats the jobs as recomputed when the subscribed workflow leaves one of its own unset", () => {
    const subscriptions = collectEventSubscriptions([
      runner,
      target({
        configPath: "buyer/tailor.config.ts",
        types: ["Order"],
        executors: {
          "watch-jobs": { kind: "workflowJobExecution", workflowName: "other" },
        },
      }),
    ]);

    expect(subscriptions.map((subscription) => subscription.pinned)).toEqual([false]);
    expect(() => assertRecordableDependencies(subscriptions, true)).toThrow(
      /resolves without an "id"/,
    );
  });
});

describe("collectEventSubscriptions and a resolver name held in two namespaces", () => {
  // Resolver names are only namespace-unique. The namespace the subscriber sees
  // the name through decides which resolver is subscribed, so reading the pin or
  // the record key back off the owner by bare name can land on the other one.
  const owner = target({
    configPath: "supplier/tailor.config.ts",
    namespace: "public",
    resolvers: ["processOrder"],
    extraResolverNamespace: {
      namespace: "pipeline-internal",
      resolvers: ["processOrder"],
      pinned: ["processOrder"],
    },
  });
  const subscriber = target({
    configPath: "buyer/tailor.config.ts",
    appId: supplierId,
    types: ["Order"],
    externalResolverNamespaces: ["pipeline-public"],
    executors: { "sync-order": { kind: "resolverExecuted", resolverName: "processOrder" } },
  });

  test("takes the pin from the namespace the subscriber sees", () => {
    const subscriptions = collectEventSubscriptions([owner, subscriber]);

    expect(subscriptions).toHaveLength(1);
    // pipeline-internal declares the value; pipeline-public does not.
    expect(subscriptions[0]?.pinned).toBe(false);
  });

  test("records the dependency on the resolver the subscriber sees", () => {
    const subscriptions = collectEventSubscriptions([owner, subscriber]);

    expect(subscriptions[0]?.key).toBe("pipeline:pipeline-public:resolver:processOrder");
    expect([...collectDependentApps(subscriptions).keys()]).toEqual([
      "pipeline:pipeline-public:resolver:processOrder",
    ]);
  });
});

describe("assertRecordableDependencies and an id that cannot form a label key", () => {
  // Label keys are lowercase, but the config's own id validation accepts a UUID in
  // any case. Without this check the run reaches apply and the write throws
  // partway through, once sibling resources have already been mutated.
  const uppercase = supplierId.toUpperCase();
  const subscriptions = () =>
    collectEventSubscriptions([
      target({ configPath: "supplier/tailor.config.ts", types: ["Order"] }),
      target({
        configPath: "buyer/tailor.config.ts",
        appId: uppercase,
        types: ["Invoice"],
        executors: { "sync-order": { kind: "tailordb", tableName: "Order" } },
      }),
    ]);

  test("rejects an uppercase id on a run that applies changes", () => {
    expect(() => assertRecordableDependencies(subscriptions(), true)).toThrow(
      /is not the lowercase UUID deploy writes/,
    );
  });

  test("leaves a dry run alone, which never has an id injected", () => {
    expect(() => assertRecordableDependencies(subscriptions(), false)).not.toThrow();
  });
});

describe("collectEventSubscriptions and a resolver name the subscriber also declares", () => {
  // The trigger resolves a locally declared resolver first and only then the
  // namespaces the config sees, so a peer holding the same name must not make the
  // local one look ambiguous. Losing the key here drops the resolver from the
  // run's subscribed set, and the confirmation then asks about a resolver this
  // run still keeps publishing.
  const subscriptions = () =>
    collectEventSubscriptions([
      target({
        configPath: "buyer/tailor.config.ts",
        namespace: "local",
        appId: supplierId,
        resolvers: ["processOrder"],
        externalResolverNamespaces: ["pipeline-shared"],
        executors: { "sync-order": { kind: "resolverExecuted", resolverName: "processOrder" } },
      }),
      target({
        configPath: "supplier/tailor.config.ts",
        namespace: "shared",
        resolvers: ["processOrder"],
      }),
    ]);

  test("keys the subscription by the locally declared namespace", () => {
    expect(subscriptions()).toHaveLength(1);
    expect(subscriptions()[0]?.key).toBe("pipeline:pipeline-local:resolver:processOrder");
  });

  test("owns the subscription itself rather than the peer", () => {
    expect(subscriptions()[0]?.owner.config.path).toBe("buyer/tailor.config.ts");
  });
});

describe("collectEventSubscriptions and a disabled executor", () => {
  test.each([
    {
      kind: "tailordb",
      trigger: { kind: "tailordb", tableName: "Order" },
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
  ])("a disabled executor subscribes to nothing ($kind)", ({ trigger, owns }) => {
    const subscriptions = collectEventSubscriptions([
      target({
        configPath: "buyer/tailor.config.ts",
        ...owns,
        disabledExecutors: { "sync-it": trigger },
      }),
    ]);
    expect(subscriptions).toEqual([]);
  });

  test("an enabled executor still subscribes alongside a disabled one", () => {
    const subscriptions = collectEventSubscriptions([
      target({
        configPath: "buyer/tailor.config.ts",
        types: ["Order", "Invoice"],
        executors: { "on-order": { kind: "tailordb", tableName: "Order" } },
        disabledExecutors: { "on-invoice": { kind: "tailordb", tableName: "Invoice" } },
      }),
    ]);
    expect(subscriptions.map((subscription) => subscription.executorName)).toEqual(["on-order"]);
  });

  test("a disabled executor does not demand the subscribed resource exist", () => {
    expect(() =>
      collectEventSubscriptions([
        target({
          configPath: "buyer/tailor.config.ts",
          disabledExecutors: {
            "sync-it": { kind: "tailordb", tableName: "Nonexistent" },
          },
        }),
      ]),
    ).not.toThrow();
  });
});
