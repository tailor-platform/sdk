import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { createChangeSet } from "./change-set";
import {
  computeRenamedAppDeletions,
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
