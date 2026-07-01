import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { createChangeSet } from "./change-set";
import {
  assertUniqueGlobalFunctionNames,
  confirmDeploymentPlans,
  computeRenamedAppDeletions,
  collectVisibleResolverNamespaces,
  collectVisibleTailorDBTypeNamespaces,
  dropCrossDeploymentManagedDeletes,
  parseDeployConfigPaths,
  printDeploymentPlans,
  printPlanResults,
  summarizePlanResults,
} from "./deploy";
import type { PlannedDeployment } from "./apply-phases";
import type { GroupedDisplayEntry, NamespaceAction } from "./grouped-display";

type PlanResults = Parameters<typeof summarizePlanResults>[0];

function emptyResults(): PlanResults {
  return {
    functionRegistry: {
      changeSet: createChangeSet("Function registry"),
      workflowJobChanges: { creates: [], updates: [], deletes: [], replaces: [], unchanged: [] },
      resolverFunctionChanges: {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
        unchanged: [],
      },
      executorFunctionChanges: {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
        unchanged: [],
      },
      authHookFunctionChanges: {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
        unchanged: [],
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    },
    tailorDB: {
      changeSet: {
        service: createChangeSet("TailorDB services"),
        type: createChangeSet("TailorDB types"),
        gqlPermission: createChangeSet("TailorDB gqlPermissions"),
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
      context: {
        workspaceId: "ws",
        application: {} as PlanResults["tailorDB"]["context"]["application"],
        tailorDBInputs: [],
        executorUsedTypes: new Set<string>(),
        config: {} as PlanResults["tailorDB"]["context"]["config"],
        noSchemaCheck: false,
      },
    },
    staticWebsite: {
      changeSet: createChangeSet("StaticWebsites"),
      customDomainChangeSet: createChangeSet("CustomDomains"),
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    },
    aiGateway: {
      changeSet: createChangeSet("AIGateways"),
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    },
    idp: {
      changeSet: {
        service: createChangeSet("IdP services"),
        client: createChangeSet("IdP clients"),
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    },
    auth: {
      changeSet: {
        service: createChangeSet("Auth services"),
        idpConfig: createChangeSet("Auth idpConfigs"),
        userProfileConfig: createChangeSet("Auth userProfileConfigs"),
        tenantConfig: createChangeSet("Auth tenantConfigs"),
        machineUser: createChangeSet("Auth machineUsers"),
        oauth2Client: createChangeSet("Auth oauth2Clients"),
        authHook: createChangeSet("Auth hooks"),
        scim: createChangeSet("Auth scim"),
        scimResource: createChangeSet("Auth scimResources"),
        connection: createChangeSet("Auth connections"),
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    },
    pipeline: {
      changeSet: {
        service: createChangeSet("Pipeline services"),
        resolver: createChangeSet("Pipeline resolvers"),
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    },
    app: createChangeSet("Applications"),
    executor: {
      changeSet: createChangeSet("Executors"),
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    },
    workflow: {
      changeSet: createChangeSet("Workflows"),
      unchangedWorkflowJobNames: new Set<string>(),
      jobFunctionDeletes: [],
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
      appName: "my-app",
      appId: undefined,
    },
    secretManager: {
      vaultChangeSet: createChangeSet("Vaults"),
      secretChangeSet: createChangeSet("Secrets"),
      skippedSecrets: [],
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set<string>(),
    },
  } satisfies PlanResults;
}

function entry(action: GroupedDisplayEntry["action"], name: string): GroupedDisplayEntry {
  return { action, symbol: "+", name, labels: [] };
}

function plannedDeployment(name: string, results: PlanResults): PlannedDeployment {
  return {
    application: { name },
    ...results,
  } as unknown as PlannedDeployment;
}

function muteConfirmLogger(): () => void {
  const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  const logSpy = vi.spyOn(logger, "log").mockImplementation(() => {});
  const successSpy = vi.spyOn(logger, "success").mockImplementation(() => {});
  const newlineSpy = vi.spyOn(logger, "newline").mockImplementation(() => {});
  return () => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    successSpy.mockRestore();
    newlineSpy.mockRestore();
  };
}

describe("summarizePlanResults", () => {
  test("counts display entries and service actions", () => {
    const displayEntries: GroupedDisplayEntry[] = [
      entry("create", "Project"),
      entry("update", "Customer"),
      entry("update", "add"),
      entry("delete", "old-executor"),
    ];
    const serviceActions: NamespaceAction[] = [
      { name: "tailordb", action: "update" },
      { name: "my-resolver", action: "update" },
    ];

    const summary = summarizePlanResults(emptyResults(), displayEntries, serviceActions);

    expect(summary).toEqual({
      create: 1,
      update: 4,
      delete: 1,
      replace: 0,
    });
  });

  test("includes non-grouped changesets in counts", () => {
    const results = emptyResults();
    results.staticWebsite.changeSet.creates.push({ name: "my-site" } as never);
    results.app.updates.push({ name: "my-app" } as never);

    const summary = summarizePlanResults(results, [], []);

    expect(summary).toEqual({
      create: 1,
      update: 1,
      delete: 0,
      replace: 0,
    });
  });

  test("counts other function registry changes not split into resource groups", () => {
    const results = emptyResults();
    results.functionRegistry.changeSet.creates.push({ name: "custom-function" } as never);

    const summary = summarizePlanResults(results, [], []);

    expect(summary).toEqual({
      create: 1,
      update: 0,
      delete: 0,
      replace: 0,
    });
  });

  test("does not double-count function registry entries that are split into resource groups", () => {
    const results = emptyResults();
    // These are split by splitFunctionRegistryChanges into resource-specific groups
    results.functionRegistry.changeSet.updates.push({ name: "resolver--ns--add" } as never);
    results.functionRegistry.changeSet.updates.push({ name: "executor--user-created" } as never);

    // The display entries already include these via formatChangeEntriesWithFunctionRegistry
    const displayEntries: GroupedDisplayEntry[] = [
      entry("update", "add"),
      entry("update", "user-created"),
    ];

    const summary = summarizePlanResults(results, displayEntries, []);

    // Should be 2 (from display entries), not 4 (display + raw function registry)
    expect(summary).toEqual({
      create: 0,
      update: 2,
      delete: 0,
      replace: 0,
    });
  });
});

describe("computeRenamedAppDeletions", () => {
  test("returns renamed-away apps whose resources have all moved", () => {
    const result = computeRenamedAppDeletions({
      conflicts: [{ currentOwner: "old-app" }, { currentOwner: "old-app" }],
      resourceOwners: new Set(),
      targetAppName: "new-app",
    });

    expect(result).toEqual(["old-app"]);
  });

  test("skips the target app itself even if its id was regenerated", () => {
    const result = computeRenamedAppDeletions({
      conflicts: [{ currentOwner: "my-app" }, { currentOwner: "my-app" }],
      resourceOwners: new Set(),
      targetAppName: "my-app",
    });

    expect(result).toEqual([]);
  });

  test("skips peer target apps in the same multi-config deploy", () => {
    const result = computeRenamedAppDeletions({
      conflicts: [{ currentOwner: "supplier" }],
      resourceOwners: new Set(),
      targetAppName: "buyer",
      protectedAppNames: new Set(["buyer", "supplier"]),
    });

    expect(result).toEqual([]);
  });

  test("keeps the old app when some of its resources still remain unmanaged", () => {
    const result = computeRenamedAppDeletions({
      conflicts: [{ currentOwner: "old-app" }],
      resourceOwners: new Set(["old-app"]),
      targetAppName: "new-app",
    });

    expect(result).toEqual([]);
  });

  test("returns empty when there are no conflicts", () => {
    const result = computeRenamedAppDeletions({
      conflicts: [],
      resourceOwners: new Set(),
      targetAppName: "my-app",
    });

    expect(result).toEqual([]);
  });
});

describe("parseDeployConfigPaths", () => {
  test("preserves default config lookup when no path is provided", () => {
    const previous = process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH;
    delete process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH;
    try {
      expect(parseDeployConfigPaths()).toEqual([undefined]);
    } finally {
      if (previous === undefined) {
        delete process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH;
      } else {
        process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH = previous;
      }
    }
  });

  test("splits comma-separated config paths", () => {
    expect(parseDeployConfigPaths("buyer/tailor.config.ts, supplier/tailor.config.ts")).toEqual([
      "buyer/tailor.config.ts",
      "supplier/tailor.config.ts",
    ]);
  });

  test("rejects empty comma-separated entries", () => {
    expect(() => parseDeployConfigPaths("buyer/tailor.config.ts,")).toThrow(
      "--config must contain one or more non-empty config paths.",
    );
  });
});

describe("visible same-run namespaces", () => {
  test("ignores TailorDB types in namespaces not visible to the current app", () => {
    const current = {
      tailorDBServices: [],
      externalTailorDBNamespaces: ["shared"],
    } as unknown as PlanResults["tailorDB"]["context"]["application"];
    const sharedOwner = {
      tailorDBServices: [{ namespace: "shared", types: { User: {} } }],
      externalTailorDBNamespaces: [],
    } as unknown as PlanResults["tailorDB"]["context"]["application"];
    const unrelated = {
      tailorDBServices: [{ namespace: "analytics", types: { User: {} } }],
      externalTailorDBNamespaces: [],
    } as unknown as PlanResults["tailorDB"]["context"]["application"];

    const result = collectVisibleTailorDBTypeNamespaces(current, [current, sharedOwner, unrelated]);

    expect(result.get("User")).toBe("shared");
  });

  test("ignores resolvers in namespaces not visible to the current app", () => {
    const current = {
      subgraphs: [{ Type: "pipeline", Name: "shared-pipeline" }],
      resolverServices: [],
    } as unknown as PlanResults["tailorDB"]["context"]["application"];
    const sharedOwner = {
      subgraphs: [{ Type: "pipeline", Name: "shared-pipeline" }],
      resolverServices: [
        { namespace: "shared-pipeline", resolvers: { findUser: { name: "findUser" } } },
      ],
    } as unknown as PlanResults["tailorDB"]["context"]["application"];
    const unrelated = {
      subgraphs: [{ Type: "pipeline", Name: "analytics-pipeline" }],
      resolverServices: [
        { namespace: "analytics-pipeline", resolvers: { findUser: { name: "findUser" } } },
      ],
    } as unknown as PlanResults["tailorDB"]["context"]["application"];

    const result = collectVisibleResolverNamespaces(current, [current, sharedOwner, unrelated]);

    expect(result.get("findUser")).toBe("shared-pipeline");
  });
});

describe("dropCrossDeploymentManagedDeletes", () => {
  test("drops stale deletes for resources claimed by another deployment", () => {
    const previousOwner = emptyResults();
    previousOwner.tailorDB.changeSet.service.deletes.push({ name: "shared" } as never);
    previousOwner.tailorDB.changeSet.type.deletes.push({
      name: "User",
      request: { namespaceName: "shared" },
    } as never);
    previousOwner.tailorDB.changeSet.gqlPermission.deletes.push({
      name: "User",
      request: { namespaceName: "shared" },
    } as never);

    const nextOwner = emptyResults();
    nextOwner.tailorDB.changeSet.service.updates.push({ name: "shared" } as never);
    nextOwner.tailorDB.changeSet.type.updates.push({
      name: "User",
      request: { namespaceName: "shared" },
    } as never);
    nextOwner.tailorDB.changeSet.gqlPermission.unchanged.push({
      name: "User",
      request: { namespaceName: "shared" },
    } as never);

    dropCrossDeploymentManagedDeletes([
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
    ]);

    expect(previousOwner.tailorDB.changeSet.service.deletes).toEqual([]);
    expect(previousOwner.tailorDB.changeSet.type.deletes).toEqual([]);
    expect(previousOwner.tailorDB.changeSet.gqlPermission.deletes).toEqual([]);
  });

  test("keeps deletes that are not claimed by another deployment", () => {
    const previousOwner = emptyResults();
    previousOwner.tailorDB.changeSet.type.deletes.push({
      name: "User",
      request: { namespaceName: "old" },
    } as never);

    const nextOwner = emptyResults();
    nextOwner.tailorDB.changeSet.type.updates.push({
      name: "User",
      request: { namespaceName: "new" },
    } as never);

    dropCrossDeploymentManagedDeletes([
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
    ]);

    expect(previousOwner.tailorDB.changeSet.type.deletes).toHaveLength(1);
  });

  test("drops nested deletes when another deployment claims the owning namespace", () => {
    const previousOwner = emptyResults();
    previousOwner.tailorDB.changeSet.service.deletes.push({ name: "shared" } as never);
    previousOwner.tailorDB.changeSet.type.deletes.push({
      name: "User",
      request: { namespaceName: "shared" },
    } as never);

    const nextOwner = emptyResults();
    nextOwner.tailorDB.changeSet.service.unchanged.push({ name: "shared" } as never);
    nextOwner.tailorDB.changeSet.type.unchanged.push({ name: "User" } as never);

    dropCrossDeploymentManagedDeletes([
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
    ]);

    expect(previousOwner.tailorDB.changeSet.service.deletes).toEqual([]);
    expect(previousOwner.tailorDB.changeSet.type.deletes).toEqual([]);
  });

  test("mutates filtered delete arrays in place", () => {
    const previousOwner = emptyResults();
    previousOwner.staticWebsite.changeSet.deletes.push({ name: "shared-site" } as never);
    const deletes = previousOwner.staticWebsite.changeSet.deletes;

    const nextOwner = emptyResults();
    nextOwner.staticWebsite.changeSet.unchanged.push({ name: "shared-site" } as never);

    dropCrossDeploymentManagedDeletes([
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
    ]);

    expect(previousOwner.staticWebsite.changeSet.deletes).toBe(deletes);
    expect(previousOwner.staticWebsite.changeSet.deletes).toEqual([]);
    expect(previousOwner.staticWebsite.changeSet.lines()).toEqual([]);
  });

  test("drops workflow job function deletes claimed by another deployment", () => {
    const previousOwner = emptyResults();
    previousOwner.workflow.jobFunctionDeletes.push({
      workspaceId: "ws",
      jobFunctionName: "shared-job",
    });
    const jobFunctionDeletes = previousOwner.workflow.jobFunctionDeletes;

    const nextOwner = emptyResults();
    nextOwner.workflow.changeSet.creates.push({
      name: "next-workflow",
      usedJobNames: ["shared-job"],
    } as never);

    dropCrossDeploymentManagedDeletes([
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
    ]);

    expect(previousOwner.workflow.jobFunctionDeletes).toBe(jobFunctionDeletes);
    expect(previousOwner.workflow.jobFunctionDeletes).toEqual([]);
  });

  test("drops workflow job function deletes claimed by another unchanged deployment", () => {
    const previousOwner = emptyResults();
    previousOwner.workflow.jobFunctionDeletes.push(
      {
        workspaceId: "ws",
        jobFunctionName: "shared-job",
      },
      {
        workspaceId: "ws",
        jobFunctionName: "orphaned-job",
      },
    );

    const nextOwner = emptyResults();
    nextOwner.workflow.unchangedWorkflowJobNames.add("shared-job");

    dropCrossDeploymentManagedDeletes([
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
    ]);

    expect(previousOwner.workflow.jobFunctionDeletes).toEqual([
      {
        workspaceId: "ws",
        jobFunctionName: "orphaned-job",
      },
    ]);
  });

  test("drops an app delete claimed by another deployment that creates that app", () => {
    const previousOwner = emptyResults();
    previousOwner.app.deletes.push({
      name: "shared-app",
      request: { workspaceId: "ws", applicationName: "shared-app" },
    } as never);
    const appDeletes = previousOwner.app.deletes;

    const nextOwner = emptyResults();
    nextOwner.app.creates.push({ name: "shared-app" } as never);

    dropCrossDeploymentManagedDeletes([
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
    ]);

    expect(previousOwner.app.deletes).toBe(appDeletes);
    expect(previousOwner.app.deletes).toEqual([]);
  });

  test("drops an app delete claimed by another deployment that leaves that app unchanged", () => {
    const previousOwner = emptyResults();
    previousOwner.app.deletes.push({
      name: "shared-app",
      request: { workspaceId: "ws", applicationName: "shared-app" },
    } as never);

    const nextOwner = emptyResults();
    nextOwner.app.unchanged.push({ name: "shared-app" } as never);

    dropCrossDeploymentManagedDeletes([
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
    ]);

    expect(previousOwner.app.deletes).toEqual([]);
  });

  test("keeps an app delete not claimed by another deployment", () => {
    const previousOwner = emptyResults();
    previousOwner.app.deletes.push({
      name: "old-app",
      request: { workspaceId: "ws", applicationName: "old-app" },
    } as never);

    const nextOwner = emptyResults();
    nextOwner.app.creates.push({ name: "different-app" } as never);

    dropCrossDeploymentManagedDeletes([
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
    ]);

    expect(previousOwner.app.deletes).toHaveLength(1);
  });
});

describe("confirmDeploymentPlans", () => {
  test("uses resource owners from all deployments before deleting renamed apps", async () => {
    const restoreLogger = muteConfirmLogger();
    try {
      const renamedTarget = emptyResults();
      renamedTarget.tailorDB.conflicts.push({
        resourceType: "TailorDB service",
        resourceName: "shared",
        currentOwner: "old-app",
      });

      const peer = emptyResults();
      peer.staticWebsite.resourceOwners.add("old-app");

      await confirmDeploymentPlans({
        deployments: [
          plannedDeployment("new-app", renamedTarget),
          plannedDeployment("peer-app", peer),
        ],
        yes: true,
      });

      expect(renamedTarget.app.deletes).toEqual([]);
    } finally {
      restoreLogger();
    }
  });

  test("deduplicates renamed app deletions across deployments", async () => {
    const restoreLogger = muteConfirmLogger();
    try {
      const first = emptyResults();
      first.tailorDB.conflicts.push({
        resourceType: "TailorDB service",
        resourceName: "shared",
        currentOwner: "old-app",
      });
      const second = emptyResults();
      second.pipeline.conflicts.push({
        resourceType: "Pipeline service",
        resourceName: "shared-pipeline",
        currentOwner: "old-app",
      });

      await confirmDeploymentPlans({
        deployments: [
          plannedDeployment("new-app-a", first),
          plannedDeployment("new-app-b", second),
        ],
        yes: true,
      });

      expect([...first.app.deletes, ...second.app.deletes].map((item) => item.name)).toEqual([
        "old-app",
      ]);
    } finally {
      restoreLogger();
    }
  });
});

describe("printPlanResults", () => {
  test("routes dry-run output to stdout via logger.out", () => {
    const outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});
    const logSpy = vi.spyOn(logger, "log").mockImplementation(() => {});

    printPlanResults(emptyResults(), { dryRun: true });

    expect(outSpy).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();

    outSpy.mockRestore();
    logSpy.mockRestore();
  });

  test("routes apply output to stderr via logger.log", () => {
    const outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});
    const logSpy = vi.spyOn(logger, "log").mockImplementation(() => {});

    printPlanResults(emptyResults(), { dryRun: false });

    expect(logSpy).toHaveBeenCalled();
    expect(outSpy).not.toHaveBeenCalled();

    outSpy.mockRestore();
    logSpy.mockRestore();
  });

  test("emits JSON with summary, changes, warnings, and conflicts for dry-run --json", () => {
    using _json = jsonMode();
    const outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});

    const summary = printPlanResults(emptyResults(), { dryRun: true });

    expect(outSpy).toHaveBeenCalledOnce();
    const payload = outSpy.mock.calls[0]?.[0] as {
      summary: unknown;
      changes: unknown[];
      warnings: unknown[];
      conflicts: unknown[];
    };
    expect(payload).toHaveProperty("summary");
    expect(payload).toHaveProperty("changes");
    expect(payload).toHaveProperty("warnings");
    expect(payload).toHaveProperty("conflicts");
    expect(Array.isArray(payload.changes)).toBe(true);
    expect(Array.isArray(payload.warnings)).toBe(true);
    expect(Array.isArray(payload.conflicts)).toBe(true);
    expect(summary.create).toBe(0);

    outSpy.mockRestore();
  });

  test("includes unmanaged resources and skipped secrets in warnings", () => {
    using _json = jsonMode();
    const outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});

    const results = emptyResults();
    results.tailorDB.unmanaged = [{ resourceType: "tailorDB", resourceName: "OldType" }];
    results.secretManager.skippedSecrets = ["DB_PASSWORD"];

    printPlanResults(results, { dryRun: true });

    const payload = outSpy.mock.calls[0]?.[0] as {
      warnings: Array<{ type: string; resourceType: string; name: string }>;
    };
    expect(payload.warnings).toContainEqual({
      type: "unmanaged",
      resourceType: "tailorDB",
      name: "OldType",
    });
    expect(payload.warnings).toContainEqual({
      type: "skippedSecret",
      resourceType: "secret",
      name: "DB_PASSWORD",
    });

    outSpy.mockRestore();
  });

  test("includes owner conflicts in conflicts", () => {
    using _json = jsonMode();
    const outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});

    const results = emptyResults();
    results.tailorDB.conflicts = [
      { resourceType: "tailorDB", resourceName: "User", currentOwner: "other-app" },
    ];

    printPlanResults(results, { dryRun: true });

    const payload = outSpy.mock.calls[0]?.[0] as {
      conflicts: Array<{ resourceType: string; name: string; currentOwner: string }>;
    };
    expect(payload.conflicts).toContainEqual({
      resourceType: "tailorDB",
      name: "User",
      currentOwner: "other-app",
    });

    outSpy.mockRestore();
  });

  test("does not emit JSON for apply --json; still prints plan to stderr", () => {
    using _json = jsonMode();
    const outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});
    const logSpy = vi.spyOn(logger, "log").mockImplementation(() => {});

    printPlanResults(emptyResults(), { dryRun: false });

    expect(outSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();

    outSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("printDeploymentPlans", () => {
  test("emits one aggregate payload for multi-config dry-run --json", () => {
    using _json = jsonMode();
    const outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});

    const first = emptyResults();
    first.staticWebsite.changeSet.creates.push({ name: "buyer-site" } as never);
    const second = emptyResults();
    second.aiGateway.changeSet.creates.push({ name: "supplier-gateway" } as never);

    const summary = printDeploymentPlans(
      [plannedDeployment("buyer", first), plannedDeployment("supplier", second)],
      { dryRun: true },
    );

    expect(outSpy).toHaveBeenCalledOnce();
    const payload = outSpy.mock.calls[0]?.[0] as {
      summary: { create: number };
      changes: Array<{ action: string; name: string }>;
      warnings: unknown[];
      conflicts: unknown[];
    };
    expect(summary.create).toBe(2);
    expect(payload.summary.create).toBe(2);
    expect(payload.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "create", name: "buyer-site" }),
        expect.objectContaining({ action: "create", name: "supplier-gateway" }),
      ]),
    );
    expect(payload.warnings).toEqual([]);
    expect(payload.conflicts).toEqual([]);

    outSpy.mockRestore();
  });
});

type FakeBundledScripts = {
  resolvers?: Record<string, string>;
  executors?: Record<string, string>;
  workflowJobs?: Record<string, string>;
  authHooks?: Record<string, string>;
};

function fakeTarget(
  bundles: FakeBundledScripts,
): Parameters<typeof assertUniqueGlobalFunctionNames>[0][number] {
  return {
    bundledScripts: {
      resolvers: new Map(Object.entries(bundles.resolvers ?? {})),
      executors: new Map(Object.entries(bundles.executors ?? {})),
      workflowJobs: new Map(Object.entries(bundles.workflowJobs ?? {})),
      authHooks: new Map(Object.entries(bundles.authHooks ?? {})),
    },
  } as unknown as Parameters<typeof assertUniqueGlobalFunctionNames>[0][number];
}

describe("assertUniqueGlobalFunctionNames", () => {
  test("throws when two configs define the same executor name", () => {
    expect(() =>
      assertUniqueGlobalFunctionNames([
        fakeTarget({ executors: { "sync-user": "a" } }),
        fakeTarget({ executors: { "sync-user": "b" } }),
      ]),
    ).toThrow(
      'Duplicate executor name "sync-user" across config files. Executor and workflow job names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same workflow job name", () => {
    expect(() =>
      assertUniqueGlobalFunctionNames([
        fakeTarget({ workflowJobs: { "notify-job": "a" } }),
        fakeTarget({ workflowJobs: { "notify-job": "b" } }),
      ]),
    ).toThrow(
      'Duplicate workflow job name "notify-job" across config files. Executor and workflow job names must be unique across all configs in a single deploy.',
    );
  });

  test("accepts distinct executor names across configs", () => {
    expect(() =>
      assertUniqueGlobalFunctionNames([
        fakeTarget({ executors: { "sync-user": "a" } }),
        fakeTarget({ executors: { "sync-order": "b" } }),
      ]),
    ).not.toThrow();
  });

  test("is a no-op for a single config", () => {
    expect(() =>
      assertUniqueGlobalFunctionNames([fakeTarget({ executors: { "sync-user": "a" } })]),
    ).not.toThrow();
  });

  test("accepts the same resolver name in different namespaces", () => {
    expect(() =>
      assertUniqueGlobalFunctionNames([
        fakeTarget({ resolvers: { get: "buyer" } }),
        fakeTarget({ resolvers: { get: "supplier" } }),
      ]),
    ).not.toThrow();
  });

  test("ignores duplicate resolver bundle names across configs", () => {
    expect(() =>
      assertUniqueGlobalFunctionNames([
        fakeTarget({ resolvers: { get: "a" } }),
        fakeTarget({ resolvers: { get: "b" } }),
      ]),
    ).not.toThrow();
  });

  test("ignores duplicate auth hook bundle names across configs", () => {
    expect(() =>
      assertUniqueGlobalFunctionNames([
        fakeTarget({ authHooks: { "before-login": "a" } }),
        fakeTarget({ authHooks: { "before-login": "b" } }),
      ]),
    ).not.toThrow();
  });
});
