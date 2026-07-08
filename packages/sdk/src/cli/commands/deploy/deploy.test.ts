import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { createChangeSet } from "./change-set";
import {
  assertUniqueGlobalResourceNames,
  buildDeploymentTargets,
  confirmDeploymentPlans,
  computeRenamedAppDeletions,
  collectExternalAuthIdpConfigNames,
  collectVisibleIdpNames,
  collectVisibleResolverNamespaces,
  collectVisibleTailorDBTypeNamespaces,
  dropCrossDeploymentManagedDeletes,
  mergeBundledScripts,
  parseDeployConfigPaths,
  planDeploymentTargets,
  printDeploymentPlans,
  printPlanResults,
  summarizePlanResults,
} from "./deploy";
import type { PlannedDeployment } from "./apply-phases";
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
    workflowExecutionPolicy: {
      changeSet: createChangeSet("Workflow execution policies"),
      ...emptyOwnership(),
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
  test.each<{
    name: string;
    conflicts: Array<{ currentOwner: string }>;
    resourceOwners: Set<string>;
    protectedAppNames: Set<string>;
    expected: string[];
  }>([
    {
      name: "returns renamed-away apps whose resources have all moved",
      conflicts: [{ currentOwner: "old-app" }, { currentOwner: "old-app" }],
      resourceOwners: new Set(),
      protectedAppNames: new Set(["new-app"]),
      expected: ["old-app"],
    },
    {
      name: "skips the target app itself even if its id was regenerated",
      conflicts: [{ currentOwner: "my-app" }, { currentOwner: "my-app" }],
      resourceOwners: new Set(),
      protectedAppNames: new Set(["my-app"]),
      expected: [],
    },
    {
      name: "skips peer target apps in the same multi-config deploy",
      conflicts: [{ currentOwner: "supplier" }],
      resourceOwners: new Set(),
      protectedAppNames: new Set(["buyer", "supplier"]),
      expected: [],
    },
    {
      name: "keeps the old app when some of its resources still remain unmanaged",
      conflicts: [{ currentOwner: "old-app" }],
      resourceOwners: new Set(["old-app"]),
      protectedAppNames: new Set(["new-app"]),
      expected: [],
    },
    {
      name: "returns empty when there are no conflicts",
      conflicts: [],
      resourceOwners: new Set(),
      protectedAppNames: new Set(["my-app"]),
      expected: [],
    },
  ])("$name", ({ conflicts, resourceOwners, protectedAppNames, expected }) => {
    const result = computeRenamedAppDeletions({
      conflicts,
      resourceOwners,
      protectedAppNames,
    });
    expect(result).toEqual(expected);
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

  test("collects IdP names declared by peer configs when the current app references them", () => {
    const current = {
      idpServices: [],
      subgraphs: [{ Type: "idp", Name: "peer-idp" }],
    } as unknown as PlanResults["tailorDB"]["context"]["application"];
    const peer = {
      idpServices: [{ name: "peer-idp" }],
      subgraphs: [],
    } as unknown as PlanResults["tailorDB"]["context"]["application"];

    const result = collectVisibleIdpNames(current, [current, peer]);

    expect(result.has("peer-idp")).toBe(true);
  });

  test("ignores same-run IdPs that the current app does not reference", () => {
    const current = {
      idpServices: [],
      subgraphs: [],
    } as unknown as PlanResults["tailorDB"]["context"]["application"];
    const peer = {
      idpServices: [{ name: "peer-idp" }],
      subgraphs: [],
    } as unknown as PlanResults["tailorDB"]["context"]["application"];

    const result = collectVisibleIdpNames(current, [current, peer]);

    expect(result.has("peer-idp")).toBe(false);
  });
});

describe("dropCrossDeploymentManagedDeletes", () => {
  test("drops stale deletes for resources claimed by another deployment", () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
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
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("still managed by another config"),
    );
    debugSpy.mockRestore();
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

  test("drops workflow execution policy deletes claimed by another deployment", () => {
    const previousOwner = emptyResults();
    previousOwner.workflowExecutionPolicy.changeSet.deletes.push({ name: "premium" } as never);
    const deletes = previousOwner.workflowExecutionPolicy.changeSet.deletes;

    const nextOwner = emptyResults();
    nextOwner.workflowExecutionPolicy.changeSet.unchanged.push({ name: "premium" } as never);

    dropCrossDeploymentManagedDeletes([
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
    ]);

    expect(previousOwner.workflowExecutionPolicy.changeSet.deletes).toBe(deletes);
    expect(previousOwner.workflowExecutionPolicy.changeSet.deletes).toEqual([]);
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
    using _logger = silenceLogger("warn", "log", "success", "newline");
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
  });

  test("deduplicates renamed app deletions across deployments", async () => {
    using _logger = silenceLogger("warn", "log", "success", "newline");
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
      deployments: [plannedDeployment("new-app-a", first), plannedDeployment("new-app-b", second)],
      yes: true,
    });

    expect([...first.app.deletes, ...second.app.deletes].map((item) => item.name)).toEqual([
      "old-app",
    ]);
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
  appName?: string;
  resolvers?: Record<string, string>;
  executors?: Record<string, string>;
  workflowJobs?: Record<string, string>;
  authHooks?: Record<string, string>;
  executorNames?: string[];
  staticWebsiteNames?: string[];
  tailorDBNamespaces?: string[];
  authNamespace?: string;
  authConnectionNames?: string[];
  idpNames?: string[];
  resolverNamespaces?: string[];
  aiGatewayNames?: string[];
  vaultNames?: string[];
  workflowNames?: string[];
  executionPolicyNames?: string[];
};

let fakeTargetSequence = 0;

function fakeTarget(
  bundles: FakeBundledScripts,
): Parameters<typeof assertUniqueGlobalResourceNames>[0][number] {
  fakeTargetSequence += 1;
  const executorNames = bundles.executorNames ?? Object.keys(bundles.executors ?? {});
  const resolverNames = Object.keys(bundles.resolvers ?? {});
  return {
    application: {
      name: bundles.appName ?? `fake-app-${fakeTargetSequence}`,
      executorService: {
        executors: Object.fromEntries(executorNames.map((name) => [`/${name}.ts`, { name }])),
      },
      workflowService: {
        workflows: Object.fromEntries(
          (bundles.workflowNames ?? []).map((name) => [name, { name }]),
        ),
      },
      staticWebsiteServices: (bundles.staticWebsiteNames ?? []).map((name) => ({ name })),
      tailorDBServices: (bundles.tailorDBNamespaces ?? []).map((namespace) => ({ namespace })),
      authService: bundles.authNamespace
        ? {
            config: { name: bundles.authNamespace },
            connections: Object.fromEntries(
              (bundles.authConnectionNames ?? []).map((name) => [name, {}]),
            ),
          }
        : undefined,
      idpServices: (bundles.idpNames ?? []).map((name) => ({ name })),
      resolverServices: (bundles.resolverNamespaces ?? []).map((namespace) => ({
        namespace,
        resolvers: Object.fromEntries(resolverNames.map((name) => [name, { name }])),
      })),
      aiGatewayServices: (bundles.aiGatewayNames ?? []).map((name) => ({ name })),
      secrets: (bundles.vaultNames ?? []).map((vaultName) => ({ vaultName })),
    },
    config: {
      workflow: {
        executionPolicies: Object.fromEntries(
          (bundles.executionPolicyNames ?? []).map((name) => [name, { name }]),
        ),
      },
    },
    bundledScripts: {
      resolvers: new Map(Object.entries(bundles.resolvers ?? {})),
      executors: new Map(Object.entries(bundles.executors ?? {})),
      workflowJobs: new Map(Object.entries(bundles.workflowJobs ?? {})),
      authHooks: new Map(Object.entries(bundles.authHooks ?? {})),
    },
  } as unknown as Parameters<typeof assertUniqueGlobalResourceNames>[0][number];
}

describe("multi-config deployment orchestration", () => {
  test("starts every config build before awaiting a build result", async () => {
    const started: Array<string | undefined> = [];
    const releases: Array<() => void> = [];

    const buildPromise = buildDeploymentTargets({
      configPaths: ["buyer/tailor.config.ts", "supplier/tailor.config.ts"],
      dryRun: false,
      buildOnly: false,
      noCache: false,
      packageVersion: "test",
      cacheDir: "cache",
      buildTarget: async (params) => {
        started.push(params.configPath);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return fakeTarget({ appName: params.configPath }) as never;
      },
    });

    await vi.waitFor(() =>
      expect(started).toEqual(["buyer/tailor.config.ts", "supplier/tailor.config.ts"]),
    );
    releases.forEach((release) => release());

    await expect(buildPromise).resolves.toHaveLength(2);
  });

  test("starts every config plan before awaiting a plan result", async () => {
    const targets = [fakeTarget({ appName: "buyer" }), fakeTarget({ appName: "supplier" })];
    const started: string[] = [];
    const releases: Array<() => void> = [];

    const planPromise = planDeploymentTargets({
      targets: targets as never,
      runInputs: {} as never,
      client: {} as never,
      workspaceId: "workspace-id",
      noSchemaCheck: false,
      planTarget: async (params) => {
        started.push(params.target.application.name);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return plannedDeployment(params.target.application.name, emptyResults());
      },
    });

    await vi.waitFor(() => expect(started).toEqual(["buyer", "supplier"]));
    releases.forEach((release) => release());

    await expect(planPromise).resolves.toHaveLength(2);
  });
});

describe("mergeBundledScripts", () => {
  test("allows duplicate resolver and auth hook bundle names across configs", () => {
    const bundledScripts = mergeBundledScripts([
      fakeTarget({
        resolverNamespaces: ["buyer"],
        resolvers: { get: "buyer" },
        authNamespace: "buyer-auth",
        authHooks: { "auth-hook--buyer-auth--before-login": "buyer-auth" },
      }),
      fakeTarget({
        resolverNamespaces: ["supplier"],
        resolvers: { get: "supplier" },
        authNamespace: "supplier-auth",
        authHooks: { "auth-hook--supplier-auth--before-login": "supplier-auth" },
      }),
    ]);

    expect([...bundledScripts.resolvers]).toEqual([
      ["resolver--buyer--get", "buyer"],
      ["resolver--supplier--get", "supplier"],
    ]);
    expect([...bundledScripts.authHooks]).toEqual([
      ["auth-hook--buyer-auth--before-login", "buyer-auth"],
      ["auth-hook--supplier-auth--before-login", "supplier-auth"],
    ]);
  });

  test("rejects duplicate executor, workflow job, and auth hook bundle names across configs", () => {
    expect(() =>
      mergeBundledScripts([
        fakeTarget({ executors: { sync: "buyer" } }),
        fakeTarget({ executors: { sync: "supplier" } }),
      ]),
    ).toThrow('Duplicate executor bundle name "sync" across config files.');

    expect(() =>
      mergeBundledScripts([
        fakeTarget({ workflowJobs: { notify: "buyer" } }),
        fakeTarget({ workflowJobs: { notify: "supplier" } }),
      ]),
    ).toThrow('Duplicate workflow job bundle name "notify" across config files.');

    expect(() =>
      mergeBundledScripts([
        fakeTarget({ authHooks: { "auth-hook--shared--before-login": "buyer" } }),
        fakeTarget({ authHooks: { "auth-hook--shared--before-login": "supplier" } }),
      ]),
    ).toThrow(
      'Duplicate auth hook bundle name "auth-hook--shared--before-login" across config files.',
    );
  });
});

describe("assertUniqueGlobalResourceNames", () => {
  test("throws when two configs define the same application name", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ appName: "shared-app" }),
        fakeTarget({ appName: "shared-app" }),
      ]),
    ).toThrow(
      'Duplicate Application name "shared-app" across config files. Application names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same executor name", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ executorNames: ["sync-user"] }),
        fakeTarget({ executorNames: ["sync-user"] }),
      ]),
    ).toThrow(
      'Duplicate Executor name "sync-user" across config files. Executor names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same non-bundled executor name", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ executorNames: ["forward-webhook"], executors: {} }),
        fakeTarget({ executorNames: ["forward-webhook"], executors: {} }),
      ]),
    ).toThrow(
      'Duplicate Executor name "forward-webhook" across config files. Executor names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same workflow job name", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ workflowJobs: { "notify-job": "a" } }),
        fakeTarget({ workflowJobs: { "notify-job": "b" } }),
      ]),
    ).toThrow(
      'Duplicate Workflow job name "notify-job" across config files. Workflow job names must be unique across all configs in a single deploy.',
    );
  });

  test("accepts distinct executor names across configs", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ executorNames: ["sync-user"] }),
        fakeTarget({ executorNames: ["sync-order"] }),
      ]),
    ).not.toThrow();
  });

  test("is a no-op for a single config", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([fakeTarget({ executorNames: ["sync-user"] })]),
    ).not.toThrow();
  });

  test("accepts the same resolver name in different namespaces", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ resolvers: { get: "buyer" } }),
        fakeTarget({ resolvers: { get: "supplier" } }),
      ]),
    ).not.toThrow();
  });

  test("ignores duplicate resolver bundle names across configs", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ resolvers: { get: "a" } }),
        fakeTarget({ resolvers: { get: "b" } }),
      ]),
    ).not.toThrow();
  });

  test("ignores duplicate auth hook bundle names across configs", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ authHooks: { "before-login": "a" } }),
        fakeTarget({ authHooks: { "before-login": "b" } }),
      ]),
    ).not.toThrow();
  });

  test("throws when two configs define the same StaticWebsite name", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ staticWebsiteNames: ["marketing-site"] }),
        fakeTarget({ staticWebsiteNames: ["marketing-site"] }),
      ]),
    ).toThrow(
      'Duplicate StaticWebsite name "marketing-site" across config files. StaticWebsite names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same TailorDB namespace", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ tailorDBNamespaces: ["shared-db"] }),
        fakeTarget({ tailorDBNamespaces: ["shared-db"] }),
      ]),
    ).toThrow(
      'Duplicate TailorDB namespace name "shared-db" across config files. TailorDB namespace names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same Auth namespace", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ authNamespace: "shared-auth" }),
        fakeTarget({ authNamespace: "shared-auth" }),
      ]),
    ).toThrow(
      'Duplicate Auth namespace name "shared-auth" across config files. Auth namespace names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same IdP namespace", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ idpNames: ["shared-idp"] }),
        fakeTarget({ idpNames: ["shared-idp"] }),
      ]),
    ).toThrow(
      'Duplicate IdP namespace name "shared-idp" across config files. IdP namespace names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same Resolver namespace", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ resolverNamespaces: ["shared-pipeline"] }),
        fakeTarget({ resolverNamespaces: ["shared-pipeline"] }),
      ]),
    ).toThrow(
      'Duplicate Resolver namespace name "shared-pipeline" across config files. Resolver namespace names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same AIGateway name", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ aiGatewayNames: ["shared-gateway"] }),
        fakeTarget({ aiGatewayNames: ["shared-gateway"] }),
      ]),
    ).toThrow(
      'Duplicate AIGateway name "shared-gateway" across config files. AIGateway names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same Secret Manager vault name", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ vaultNames: ["shared-vault"] }),
        fakeTarget({ vaultNames: ["shared-vault"] }),
      ]),
    ).toThrow(
      'Duplicate Secret Manager vault name "shared-vault" across config files. Secret Manager vault names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same workflow name", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ workflowNames: ["order-processing"] }),
        fakeTarget({ workflowNames: ["order-processing"] }),
      ]),
    ).toThrow(
      'Duplicate Workflow name "order-processing" across config files. Workflow names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same workflow execution policy name", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ executionPolicyNames: ["premium"] }),
        fakeTarget({ executionPolicyNames: ["premium"] }),
      ]),
    ).toThrow(
      'Duplicate Workflow execution policy name "premium" across config files. Workflow execution policy names must be unique across all configs in a single deploy.',
    );
  });

  test("throws when two configs define the same Auth connection name", () => {
    expect(() =>
      assertUniqueGlobalResourceNames([
        fakeTarget({ authNamespace: "auth-a", authConnectionNames: ["google-sso"] }),
        fakeTarget({ authNamespace: "auth-b", authConnectionNames: ["google-sso"] }),
      ]),
    ).toThrow(
      'Duplicate Auth connection name "google-sso" across config files. Auth connection names must be unique across all configs in a single deploy.',
    );
  });
});

function fakeAuthTarget(
  name: string,
  idpConfigName?: string,
): Parameters<typeof collectExternalAuthIdpConfigNames>[0][number] {
  return {
    application: {
      authService: {
        config: {
          name,
          idProvider: idpConfigName === undefined ? undefined : { name: idpConfigName },
        },
      },
    },
  } as unknown as Parameters<typeof collectExternalAuthIdpConfigNames>[0][number];
}

describe("collectExternalAuthIdpConfigNames", () => {
  test("collects the IdP config name declared by each auth namespace", () => {
    const result = collectExternalAuthIdpConfigNames([fakeAuthTarget("shared-auth", "my-idp")]);

    expect(result.get("shared-auth")).toBe("my-idp");
  });

  test("throws when two configs declare the same auth namespace with different IdP configs", () => {
    expect(() =>
      collectExternalAuthIdpConfigNames([
        fakeAuthTarget("shared-auth", "idp-a"),
        fakeAuthTarget("shared-auth", "idp-b"),
      ]),
    ).toThrow(
      'Auth namespace "shared-auth" is defined by multiple config files with different IdP configs. Auth namespace names must be unique across all configs in a single deploy.',
    );
  });

  test("does not throw when two configs declare the same auth namespace with the same IdP config", () => {
    expect(() =>
      collectExternalAuthIdpConfigNames([
        fakeAuthTarget("shared-auth", "my-idp"),
        fakeAuthTarget("shared-auth", "my-idp"),
      ]),
    ).not.toThrow();
  });
});
