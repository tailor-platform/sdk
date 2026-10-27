import { isPlainObject } from "es-toolkit";
import { createChangeSet } from "../change-set";
import type { PlanResults } from "../apply-phases";

/** A delete that every planned delete list accepts, including workflow job function deletes. */
export const PLANNED_DELETE = {
  name: "planned-delete",
  jobFunctionName: "planned-delete",
  workspaceId: "workspace-id",
  request: {},
};

function emptyFunctionChanges() {
  return { creates: [], updates: [], deletes: [], replaces: [], unchanged: [] };
}

function emptyOwnership() {
  return { conflicts: [], unmanaged: [], resourceOwners: new Set<string>() };
}

/**
 * Build plan results that plan no change.
 * @returns Plan results with every change set empty
 */
export function emptyPlanResults(): PlanResults {
  return {
    functionRegistry: {
      changeSet: createChangeSet("Function registry"),
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
      context: {
        workspaceId: "ws",
        application: {} as PlanResults["tailorDB"]["context"]["application"],
        tailorDBInputs: [],
        executorUsedTables: new Set<string>(),
        config: {} as PlanResults["tailorDB"]["context"]["config"],
        noSchemaCheck: false,
        namespacesWithMigrations: [],
        migrationFileState: {},
        checkpointRepairs: [],
      },
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
    app: Object.assign(
      createChangeSet("Applications"),
      emptyOwnership(),
    ) as unknown as PlanResults["app"],
    executor: {
      changeSet: createChangeSet("Executors"),
      ...emptyOwnership(),
      existingExecutors: {},
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

/**
 * Find every list of planned deletes: each change set's deletes and each `*Deletes` list.
 * @param results - Plan results to search
 * @returns The lists themselves, keyed by their dotted path in `results`
 */
export function plannedDeleteLists(results: PlanResults): Map<string, unknown[]> {
  const lists = new Map<string, unknown[]>();
  const visit = (value: unknown, path: string) => {
    if (!isPlainObject(value)) return;
    if (Array.isArray(value.deletes) && typeof value.lines === "function") {
      lists.set(path, value.deletes);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (key.endsWith("Deletes") && Array.isArray(child)) {
        lists.set(childPath, child);
      } else {
        visit(child, childPath);
      }
    }
  };
  visit(results, "");
  return lists;
}
