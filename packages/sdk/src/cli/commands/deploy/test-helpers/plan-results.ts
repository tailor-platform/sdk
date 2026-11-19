import { isPlainObject } from "es-toolkit/predicate";
import { createChangeSet } from "../change-set";
import type { PlanResults } from "../apply-phases";

/** An item that every change set and delete list accepts, including workflow job function deletes. */
export const PLANNED_ITEM = {
  name: "planned-item",
  jobFunctionName: "planned-item",
  workspaceId: "workspace-id",
  request: {},
};

function emptyFunctionChanges() {
  return { creates: [], updates: [], deletes: [], replaces: [], unchanged: [] };
}

function emptyOwnership() {
  return { conflicts: [], unmanaged: [], resourceOwners: new Set<string>() };
}

type TailorDBPlanResultContext = PlanResults["tailorDB"]["context"];

/**
 * Build the context of a TailorDB plan result.
 * @param overrides - Fields that differ from a plan without tables or migrations
 * @returns TailorDB plan result context
 */
export function tailorDBPlanResultContext(
  overrides: Partial<TailorDBPlanResultContext> = {},
): TailorDBPlanResultContext {
  return {
    workspaceId: "ws",
    application: {} as TailorDBPlanResultContext["application"],
    tailorDBInputs: [],
    executorUsedTables: new Set<string>(),
    config: {} as TailorDBPlanResultContext["config"],
    noSchemaCheck: false,
    namespacesWithMigrations: [],
    migrationFileState: {},
    checkpointRepairs: [],
    pendingMigrations: [],
    ...overrides,
  };
}

/**
 * Build plan results that plan no change.
 * @returns Plan results with every change set empty
 */
export function emptyPlanResults(): PlanResults {
  return {
    functionRegistry: {
      changeSet: createChangeSet("Function registry"),
      metadataUpdates: [],
      workflowJobChanges: emptyFunctionChanges(),
      resolverFunctionChanges: emptyFunctionChanges(),
      executorFunctionChanges: emptyFunctionChanges(),
      authHookFunctionChanges: emptyFunctionChanges(),
      ...emptyOwnership(),
      existingMap: {},
    },
    tailorDB: {
      changeSet: {
        service: createChangeSet("TailorDB services"),
        type: createChangeSet("TailorDB tables"),
        gqlPermission: createChangeSet("TailorDB gqlPermissions"),
      },
      ...emptyOwnership(),
      context: tailorDBPlanResultContext(),
    },
    staticWebsite: {
      changeSet: createChangeSet("StaticWebsites"),
      customDomainChangeSet: createChangeSet("CustomDomains"),
      customDomainTransferChangeSet: createChangeSet("CustomDomainTransfers"),
      customDomainNotes: [],
      customDomainLiveOffers: new Map(),
      ...emptyOwnership(),
    },
    aiGateway: {
      changeSet: createChangeSet("AIGateways"),
      ...emptyOwnership(),
      existingGateways: {},
    },
    idp: {
      changeSet: {
        service: createChangeSet("IdP services"),
        client: createChangeSet("IdP clients"),
      },
      ...emptyOwnership(),
    },
    auth: {
      connectionStateScope: {
        workspaceId: "workspace-id",
        applicationId: "application-id",
        applicationName: "my-app",
      },
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
      existingServices: {},
    },
    pipeline: {
      changeSet: {
        service: createChangeSet("Pipeline services"),
        resolver: createChangeSet("Pipeline resolvers"),
      },
      ...emptyOwnership(),
      existingServices: {},
      existingResolvers: new Map(),
    },
    app: Object.assign(createChangeSet("Applications"), emptyOwnership(), {
      existingApplications: [],
    }) as unknown as PlanResults["app"],
    executor: {
      changeSet: createChangeSet("Executors"),
      ...emptyOwnership(),
      existingExecutors: {},
      existingExecutorDetails: new Map(),
    },
    workflow: {
      changeSet: createChangeSet("Workflows"),
      unchangedWorkflowJobNames: new Set<string>(),
      jobFunctionDeletes: [],
      jobFunctionPublishEvents: new Map<string, boolean>(),
      ...emptyOwnership(),
      appName: "my-app",
      appId: undefined,
      existingJobFunctions: new Map(),
      existingWorkflows: {},
    },
    workflowExecutionPolicy: {
      changeSet: createChangeSet("Workflow execution policies"),
      ...emptyOwnership(),
    },
    secretManager: {
      stateScope: {
        workspaceId: "workspace-id",
        applicationId: "application-id",
        applicationName: "my-app",
      },
      vaultChangeSet: createChangeSet("Vaults"),
      secretChangeSet: createChangeSet("Secrets"),
      skippedSecrets: [],
      ...emptyOwnership(),
    },
  } satisfies PlanResults;
}

type PlannedChangeSet = { creates: unknown[]; updates: unknown[]; deletes: unknown[] };

type PlanResultsVisitor = {
  changeSet: (path: string, changeSet: PlannedChangeSet) => void;
  deleteList: (path: string, list: unknown[]) => void;
};

function visitPlanResults(results: PlanResults, visitor: PlanResultsVisitor): void {
  const visit = (value: unknown, path: string) => {
    if (!isPlainObject(value)) return;
    if (Array.isArray(value.deletes) && typeof value.lines === "function") {
      visitor.changeSet(path, value as PlannedChangeSet);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (key.endsWith("Deletes") && Array.isArray(child)) {
        visitor.deleteList(childPath, child);
      } else {
        visit(child, childPath);
      }
    }
  };
  visit(results, "");
}

/**
 * Find every change set of the plan results.
 * @param results - Plan results to search
 * @returns The change sets themselves, keyed by their dotted path in `results`
 */
export function plannedChangeSets(results: PlanResults): Map<string, PlannedChangeSet> {
  const changeSets = new Map<string, PlannedChangeSet>();
  visitPlanResults(results, {
    changeSet: (path, changeSet) => changeSets.set(path, changeSet),
    deleteList: () => {},
  });
  return changeSets;
}

/**
 * Find every list of planned deletes: each change set's deletes and each `*Deletes` list.
 * @param results - Plan results to search
 * @returns The lists themselves, keyed by their dotted path in `results`
 */
export function plannedDeleteLists(results: PlanResults): Map<string, unknown[]> {
  const lists = new Map<string, unknown[]>();
  visitPlanResults(results, {
    changeSet: (path, changeSet) => lists.set(path, changeSet.deletes),
    deleteList: (path, list) => lists.set(path, list),
  });
  return lists;
}
