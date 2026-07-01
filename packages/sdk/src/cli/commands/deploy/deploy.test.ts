import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { createChangeSet } from "./change-set";
import { computeRenamedAppDeletions, printPlanResults, summarizePlanResults } from "./deploy";
import type { GroupedDisplayEntry, NamespaceAction } from "./grouped-display";

type PlanResults = Parameters<typeof summarizePlanResults>[0];

function emptyFunctionChanges() {
  return { creates: [], updates: [], deletes: [], replaces: [], unchanged: [] };
}

function emptyOwnership() {
  return { conflicts: [], unmanaged: [], resourceOwners: new Set<string>() };
}

function emptyResults(): PlanResults {
  return {
    functionRegistry: {
      changeSet: createChangeSet("Function registry"),
      workflowJobChanges: emptyFunctionChanges(),
      resolverFunctionChanges: emptyFunctionChanges(),
      executorFunctionChanges: emptyFunctionChanges(),
      authHookFunctionChanges: emptyFunctionChanges(),
      ...emptyOwnership(),
    },
    tailorDB: {
      changeSet: {
        service: createChangeSet("TailorDB services"),
        type: createChangeSet("TailorDB types"),
        gqlPermission: createChangeSet("TailorDB gqlPermissions"),
      },
      ...emptyOwnership(),
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
      ...emptyOwnership(),
    },
    aiGateway: {
      changeSet: createChangeSet("AIGateways"),
      ...emptyOwnership(),
    },
    idp: {
      changeSet: {
        service: createChangeSet("IdP services"),
        client: createChangeSet("IdP clients"),
      },
      ...emptyOwnership(),
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
      ...emptyOwnership(),
    },
    pipeline: {
      changeSet: {
        service: createChangeSet("Pipeline services"),
        resolver: createChangeSet("Pipeline resolvers"),
      },
      ...emptyOwnership(),
    },
    app: createChangeSet("Applications"),
    executor: {
      changeSet: createChangeSet("Executors"),
      ...emptyOwnership(),
    },
    workflow: {
      changeSet: createChangeSet("Workflows"),
      unchangedWorkflowJobNames: new Set<string>(),
      jobFunctionDeletes: [],
      ...emptyOwnership(),
      appName: "my-app",
      appId: undefined,
    },
    secretManager: {
      vaultChangeSet: createChangeSet("Vaults"),
      secretChangeSet: createChangeSet("Secrets"),
      skippedSecrets: [],
      ...emptyOwnership(),
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
  test.each<{
    name: string;
    conflicts: Array<{ currentOwner: string }>;
    resourceOwners: Set<string>;
    targetAppName: string;
    expected: string[];
  }>([
    {
      name: "returns renamed-away apps whose resources have all moved",
      conflicts: [{ currentOwner: "old-app" }, { currentOwner: "old-app" }],
      resourceOwners: new Set(),
      targetAppName: "new-app",
      expected: ["old-app"],
    },
    {
      name: "skips the target app itself even if its id was regenerated",
      conflicts: [{ currentOwner: "my-app" }, { currentOwner: "my-app" }],
      resourceOwners: new Set(),
      targetAppName: "my-app",
      expected: [],
    },
    {
      name: "keeps the old app when some of its resources still remain unmanaged",
      conflicts: [{ currentOwner: "old-app" }],
      resourceOwners: new Set(["old-app"]),
      targetAppName: "new-app",
      expected: [],
    },
    {
      name: "returns empty when there are no conflicts",
      conflicts: [],
      resourceOwners: new Set(),
      targetAppName: "my-app",
      expected: [],
    },
  ])("$name", ({ conflicts, resourceOwners, targetAppName, expected }) => {
    const result = computeRenamedAppDeletions({ conflicts, resourceOwners, targetAppName });
    expect(result).toEqual(expected);
  });
});

describe("printPlanResults", () => {
  let outSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    outSpy = vi.spyOn(logger, "out").mockImplementation(() => {});
    logSpy = vi.spyOn(logger, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    outSpy.mockRestore();
    logSpy.mockRestore();
  });

  test("routes dry-run output to stdout via logger.out", () => {
    printPlanResults(emptyResults(), { dryRun: true });

    expect(outSpy).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("routes apply output to stderr via logger.log", () => {
    printPlanResults(emptyResults(), { dryRun: false });

    expect(logSpy).toHaveBeenCalled();
    expect(outSpy).not.toHaveBeenCalled();
  });

  test("emits JSON with summary, changes, warnings, and conflicts for dry-run --json", () => {
    using _json = jsonMode();

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
  });

  test("includes unmanaged resources and skipped secrets in warnings", () => {
    using _json = jsonMode();

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
  });

  test("includes owner conflicts in conflicts", () => {
    using _json = jsonMode();

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
  });

  test("does not emit JSON for apply --json; still prints plan to stderr", () => {
    using _json = jsonMode();

    printPlanResults(emptyResults(), { dryRun: false });

    expect(outSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });
});
