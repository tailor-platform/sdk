import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { createChangeSet } from "./change-set";
import { computeRenamedAppDeletions, printPlanResults, summarizePlanResults } from "./deploy";
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
      unchanged: 0,
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
      unchanged: 0,
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
      unchanged: 0,
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
      unchanged: 0,
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

  test("emits JSON with summary and changes for dry-run --json", () => {
    using _json = jsonMode();
    const outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});

    const summary = printPlanResults(emptyResults(), { dryRun: true });

    expect(outSpy).toHaveBeenCalledOnce();
    const payload = outSpy.mock.calls[0]?.[0] as { summary: unknown; changes: unknown[] };
    expect(payload).toHaveProperty("summary");
    expect(payload).toHaveProperty("changes");
    expect(Array.isArray(payload.changes)).toBe(true);
    expect(summary.create).toBe(0);

    outSpy.mockRestore();
  });

  test("does not emit JSON for apply --json (caller emits after apply)", () => {
    using _json = jsonMode();
    const outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});

    printPlanResults(emptyResults(), { dryRun: false });

    expect(outSpy).not.toHaveBeenCalled();

    outSpy.mockRestore();
  });
});
