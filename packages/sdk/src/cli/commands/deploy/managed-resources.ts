import { logger } from "#/cli/shared/logger";
import { deploymentPlanResults, type PlannedDeployment, type PlanResults } from "./apply-phases";
import type { HasName } from "./change-set";
import type { ImportantResourceDeletion, OwnerConflict, UnmanagedResource } from "./confirm";
import type { BuiltDeploymentTarget } from "./deployment-target";

/**
 * Decide which renamed-away applications should be deleted. Excludes the
 * deploy targets themselves: id regeneration alone keeps the name unchanged,
 * so deleting by name would destroy a live app.
 * @param params - Inputs for the computation
 * @param params.conflicts - Detected owner conflicts across all services
 * @param params.resourceOwners - App names that still own resources we don't manage
 * @param params.protectedAppNames - App names that must not be deleted
 * @returns Names of empty old applications that should be deleted
 */
export function computeRenamedAppDeletions(params: {
  conflicts: ReadonlyArray<Pick<OwnerConflict, "currentOwner">>;
  resourceOwners: ReadonlySet<string>;
  protectedAppNames: ReadonlySet<string>;
}): string[] {
  const { conflicts, resourceOwners, protectedAppNames } = params;
  const conflictOwners = new Set(conflicts.map((c) => c.currentOwner));
  return [...conflictOwners].filter(
    (owner) => !resourceOwners.has(owner) && !protectedAppNames.has(owner),
  );
}
/**
 * Reject resource names that collide across configs. Each checked resource
 * type is workspace-global (its TRN is not qualified by namespace or app), so
 * a duplicate name would make two configs target the same platform resource:
 * one config's apply could overwrite the other's, or a fresh create could be
 * attempted twice. Resolver and auth-hook function names are namespace- or
 * app-qualified and are intentionally excluded.
 * @param targets - Built deployment targets to check
 */
export function assertUniqueGlobalResourceNames(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): void {
  for (const check of DEPLOY_MANAGED_RESOURCE_DEFINITIONS) {
    const seen = new Set<string>();
    for (const target of targets) {
      for (const name of check.namesOf(target)) {
        if (seen.has(name)) {
          throw new Error(
            `Duplicate ${check.resourceLabel} name "${name}" across config files. ${check.resourceLabel} names must be unique across all configs in a single deploy.`,
          );
        }
        seen.add(name);
      }
    }
  }
}
type OwnershipTrackedPlan = {
  conflicts: OwnerConflict[];
  unmanaged: UnmanagedResource[];
  resourceOwners: Set<string>;
};

/**
 * Every `PlanResults` entry carries ownership-tracking fields; deriving the
 * list from `results` itself (instead of naming each key) keeps these
 * collectors in sync with `PlannedDeployment` as resource types are added.
 * @param results - Plan results for a single deployment
 * @returns The ownership-tracking plan entries
 */
function ownershipTrackedPlans(results: PlanResults): ReadonlyArray<OwnershipTrackedPlan> {
  return Object.values(results);
}

export function collectOwnerConflicts(results: PlanResults): OwnerConflict[] {
  return ownershipTrackedPlans(results).flatMap((plan) => plan.conflicts);
}

export function collectUnmanagedResources(results: PlanResults): UnmanagedResource[] {
  return ownershipTrackedPlans(results).flatMap((plan) => plan.unmanaged);
}

function collectResourceOwners(results: PlanResults): Set<string> {
  return new Set(ownershipTrackedPlans(results).flatMap((plan) => [...plan.resourceOwners]));
}

export function collectImportantResourceDeletions(
  results: PlanResults,
): ImportantResourceDeletion[] {
  const importantDeletions: ImportantResourceDeletion[] = [];
  for (const del of results.tailorDB.changeSet.type.deletes) {
    importantDeletions.push({
      resourceType: "TailorDB table",
      resourceName: del.name,
    });
  }
  for (const del of results.staticWebsite.changeSet.deletes) {
    importantDeletions.push({
      resourceType: "StaticWebsite",
      resourceName: del.name,
    });
  }
  for (const del of results.aiGateway.changeSet.deletes) {
    importantDeletions.push({
      resourceType: "AIGateway",
      resourceName: del.name,
    });
  }
  for (const del of results.auth.changeSet.oauth2Client.deletes) {
    importantDeletions.push({
      resourceType: "OAuth2 client",
      resourceName: del.name,
    });
  }
  for (const replace of results.auth.changeSet.oauth2Client.replaces) {
    importantDeletions.push({
      resourceType: "OAuth2 client (client type change)",
      resourceName: replace.name,
    });
  }
  for (const del of results.auth.changeSet.connection.deletes) {
    importantDeletions.push({
      resourceType: "Auth connection",
      resourceName: del.name,
    });
  }
  for (const del of results.secretManager.vaultChangeSet.deletes) {
    importantDeletions.push({
      resourceType: "Secret Manager vault",
      resourceName: del.name,
    });
  }
  for (const del of results.secretManager.secretChangeSet.deletes) {
    importantDeletions.push({
      resourceType: "Secret Manager secret",
      resourceName: del.name,
    });
  }
  return importantDeletions;
}

type WorkflowJobFunctionItem = { jobFunctionName: string };
type ManagedResourceItem = HasName | WorkflowJobFunctionItem;

type ManagedResourceChangeSet = {
  creates: ManagedResourceItem[];
  updates: ManagedResourceItem[];
  deletes: ManagedResourceItem[];
  replaces: ManagedResourceItem[];
  unchanged: ManagedResourceItem[];
};

type ManagedResourceGroup = {
  changeSet: ManagedResourceChangeSet;
  resourceType: string;
  namespaceFields?: readonly string[];
  namespaceOwnerResourceType?: string;
  getName?: (item: ManagedResourceItem) => string;
};

function readResourceField(item: ManagedResourceItem, field: string): string | undefined {
  const itemRecord = item as unknown as Record<string, unknown>;
  for (const requestField of ["request", "deleteRequest", "createRequest"]) {
    const request = itemRecord[requestField];
    if (request && typeof request === "object" && field in request) {
      const value = (request as Record<string, unknown>)[field];
      return value == null ? undefined : String(value);
    }
  }

  const value = itemRecord[field];
  return value == null ? undefined : String(value);
}

function managedResourceName(group: ManagedResourceGroup, item: ManagedResourceItem): string {
  if (group.getName) {
    return group.getName(item);
  }
  return (item as HasName).name;
}

function managedResourceKey(group: ManagedResourceGroup, item: ManagedResourceItem): string {
  const namespace = group.namespaceFields
    ?.map((field) => readResourceField(item, field))
    .find((value) => value !== undefined);
  const name = managedResourceName(group, item);
  return namespace !== undefined
    ? `${group.resourceType}:${namespace}:${name}`
    : `${group.resourceType}:${name}`;
}

function managedNamespaceOwnerKey(
  group: ManagedResourceGroup,
  item: ManagedResourceItem,
): string | undefined {
  if (!group.namespaceOwnerResourceType) {
    return undefined;
  }
  const namespace = group.namespaceFields
    ?.map((field) => readResourceField(item, field))
    .find((value) => value !== undefined);
  return namespace !== undefined ? `${group.namespaceOwnerResourceType}:${namespace}` : undefined;
}

function addManagedResourceClaims(
  claims: Set<string>,
  group: ManagedResourceGroup,
  item: ManagedResourceItem,
): void {
  claims.add(managedResourceKey(group, item));
  const namespaceOwnerKey = managedNamespaceOwnerKey(group, item);
  if (namespaceOwnerKey) {
    claims.add(namespaceOwnerKey);
  }
}

function isManagedResourceClaimed(
  claims: ReadonlySet<string>,
  group: ManagedResourceGroup,
  item: ManagedResourceItem,
): boolean {
  if (claims.has(managedResourceKey(group, item))) {
    return true;
  }
  const namespaceOwnerKey = managedNamespaceOwnerKey(group, item);
  return namespaceOwnerKey ? claims.has(namespaceOwnerKey) : false;
}

function retainDeletesNotClaimed(
  group: ManagedResourceGroup,
  otherClaims: ReadonlySet<string>,
): void {
  let writeIndex = 0;
  for (const item of group.changeSet.deletes) {
    if (isManagedResourceClaimed(otherClaims, group, item)) {
      logger.debug(
        `Skipping delete of ${managedResourceKey(group, item)}: still managed by another config in this deploy.`,
      );
      continue;
    }
    group.changeSet.deletes[writeIndex] = item;
    writeIndex += 1;
  }
  group.changeSet.deletes.length = writeIndex;
}

function workflowJobFunctionItems(items: ReadonlyArray<ManagedResourceItem>): HasName[] {
  const jobNames = new Set<string>();
  for (const item of items) {
    const usedJobNames = (item as unknown as { usedJobNames?: unknown }).usedJobNames;
    if (!Array.isArray(usedJobNames)) {
      continue;
    }
    for (const jobName of usedJobNames) {
      if (typeof jobName === "string") {
        jobNames.add(jobName);
      }
    }
  }
  return [...jobNames].map((name) => ({ name }));
}

function workflowJobFunctionResourceGroup(results: PlanResults): ManagedResourceGroup {
  return {
    changeSet: {
      creates: workflowJobFunctionItems(results.workflow.changeSet.creates),
      updates: workflowJobFunctionItems(results.workflow.changeSet.updates),
      replaces: workflowJobFunctionItems(results.workflow.changeSet.replaces),
      unchanged: [...results.workflow.unchangedWorkflowJobNames].map((name) => ({ name })),
      deletes: results.workflow.jobFunctionDeletes,
    },
    resourceType: "workflow_job_function",
    getName: (item) => ("jobFunctionName" in item ? item.jobFunctionName : item.name),
  };
}

const MANAGED_RESOURCE_NAMESPACE_FIELDS = [
  "namespaceName",
  "authNamespace",
  "vaultName",
  "staticWebsiteName",
] as const;

type DeployManagedResourceDefinition = Omit<ManagedResourceGroup, "changeSet"> & {
  resourceLabel: string;
  namesOf: (target: BuiltDeploymentTarget) => Iterable<string>;
  changeSetOf: (results: PlanResults) => ManagedResourceChangeSet;
};

const DEPLOY_MANAGED_RESOURCE_DEFINITIONS: ReadonlyArray<DeployManagedResourceDefinition> = [
  {
    resourceLabel: "Application",
    resourceType: "application",
    namesOf: (target) => [target.application.name],
    changeSetOf: (results) => results.app,
  },
  {
    resourceLabel: "Executor",
    resourceType: "executor",
    namesOf: (target) =>
      Object.values(target.application.executorService?.executors ?? {}).map(
        (executor) => executor.name,
      ),
    changeSetOf: (results) => results.executor.changeSet,
  },
  {
    resourceLabel: "Workflow job",
    resourceType: "workflow_job_function",
    namesOf: (target) => target.bundledScripts.workflowJobs.keys(),
    changeSetOf: (results) => workflowJobFunctionResourceGroup(results).changeSet,
    getName: (item) => ("jobFunctionName" in item ? item.jobFunctionName : item.name),
  },
  {
    resourceLabel: "Workflow",
    resourceType: "workflow",
    namesOf: (target) =>
      Object.values(target.application.workflowService?.workflows ?? {}).map(
        (workflow) => workflow.name,
      ),
    changeSetOf: (results) => results.workflow.changeSet,
  },
  {
    resourceLabel: "Workflow execution policy",
    resourceType: "workflow_job_function_execution_policy",
    namesOf: (target) =>
      Object.values(target.config.workflow?.executionPolicies ?? {}).map((policy) => policy.name),
    changeSetOf: (results) => results.workflowExecutionPolicy.changeSet,
  },
  {
    resourceLabel: "Auth connection",
    resourceType: "auth.connection",
    namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
    namespaceOwnerResourceType: "auth.service",
    namesOf: (target) => Object.keys(target.application.authService?.connections ?? {}),
    changeSetOf: (results) => results.auth.changeSet.connection,
  },
  {
    resourceLabel: "StaticWebsite",
    resourceType: "staticwebsite",
    namesOf: (target) => target.application.staticWebsiteServices.map((service) => service.name),
    changeSetOf: (results) => results.staticWebsite.changeSet,
  },
  {
    resourceLabel: "TailorDB namespace",
    resourceType: "tailordb.service",
    namesOf: (target) => target.application.tailorDBServices.map((service) => service.namespace),
    changeSetOf: (results) => results.tailorDB.changeSet.service,
  },
  {
    resourceLabel: "Auth namespace",
    resourceType: "auth.service",
    namesOf: (target) => {
      const name = target.application.authService?.config.name;
      return name === undefined ? [] : [name];
    },
    changeSetOf: (results) => results.auth.changeSet.service,
  },
  {
    resourceLabel: "IdP namespace",
    resourceType: "idp.service",
    namesOf: (target) => target.application.idpServices.map((idp) => idp.name),
    changeSetOf: (results) => results.idp.changeSet.service,
  },
  {
    resourceLabel: "Resolver namespace",
    resourceType: "pipeline.service",
    namesOf: (target) => target.application.resolverServices.map((service) => service.namespace),
    changeSetOf: (results) => results.pipeline.changeSet.service,
  },
  {
    resourceLabel: "AIGateway",
    resourceType: "aigateway",
    namesOf: (target) => target.application.aiGatewayServices.map((service) => service.name),
    changeSetOf: (results) => results.aiGateway.changeSet,
  },
  {
    resourceLabel: "Secret Manager vault",
    resourceType: "secret.vault",
    namesOf: (target) => target.application.secrets.map((vault) => vault.vaultName),
    changeSetOf: (results) => results.secretManager.vaultChangeSet,
  },
];

function managedResourceGroupFromDefinition(
  definition: DeployManagedResourceDefinition,
  results: PlanResults,
): ManagedResourceGroup {
  const { changeSetOf, namesOf: _namesOf, resourceLabel: _resourceLabel, ...group } = definition;
  return {
    ...group,
    changeSet: changeSetOf(results),
  };
}

function managedResourceGroups(results: PlanResults): ManagedResourceGroup[] {
  return [
    { changeSet: results.functionRegistry.changeSet, resourceType: "function_registry" },
    ...DEPLOY_MANAGED_RESOURCE_DEFINITIONS.map((definition) =>
      managedResourceGroupFromDefinition(definition, results),
    ),
    {
      changeSet: results.tailorDB.changeSet.type,
      resourceType: "tailordb.type",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "tailordb.service",
    },
    {
      changeSet: results.tailorDB.changeSet.gqlPermission,
      resourceType: "tailordb.gql_permission",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "tailordb.service",
    },
    {
      changeSet: results.staticWebsite.customDomainChangeSet,
      resourceType: "staticwebsite.custom_domain",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "staticwebsite",
    },
    {
      changeSet: results.idp.changeSet.client,
      resourceType: "idp.client",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "idp.service",
    },
    {
      changeSet: results.auth.changeSet.idpConfig,
      resourceType: "auth.idp_config",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.userProfileConfig,
      resourceType: "auth.user_profile_config",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.tenantConfig,
      resourceType: "auth.tenant_config",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.machineUser,
      resourceType: "auth.machine_user",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.oauth2Client,
      resourceType: "auth.oauth2_client",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.authHook,
      resourceType: "auth.hook",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.scim,
      resourceType: "auth.scim",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.scimResource,
      resourceType: "auth.scim_resource",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.pipeline.changeSet.resolver,
      resourceType: "pipeline.resolver",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "pipeline.service",
    },
    {
      changeSet: results.secretManager.secretChangeSet,
      resourceType: "secret.secret",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "secret.vault",
    },
  ];
}

export function dropCrossDeploymentManagedDeletes(
  deployments: ReadonlyArray<PlannedDeployment>,
): void {
  const groupsByDeployment = deployments.map((deployment) =>
    managedResourceGroups(deploymentPlanResults(deployment)),
  );
  const claimsByDeployment = groupsByDeployment.map((groups) =>
    groups.reduce((claims, group) => {
      for (const item of [
        ...group.changeSet.creates,
        ...group.changeSet.updates,
        ...group.changeSet.replaces,
        ...group.changeSet.unchanged,
      ]) {
        addManagedResourceClaims(claims, group, item);
      }
      return claims;
    }, new Set<string>()),
  );

  groupsByDeployment.forEach((groups, deploymentIndex) => {
    const otherClaims = new Set<string>();
    claimsByDeployment.forEach((claims, claimIndex) => {
      if (claimIndex === deploymentIndex) {
        return;
      }
      for (const claim of claims) {
        otherClaims.add(claim);
      }
    });

    for (const group of groups) {
      retainDeletesNotClaimed(group, otherClaims);
    }
  });
}

export function collectDeploymentResourceOwners(
  deployments: ReadonlyArray<PlannedDeployment>,
): Set<string> {
  const owners = new Set<string>();
  for (const deployment of deployments) {
    for (const owner of collectResourceOwners(deploymentPlanResults(deployment))) {
      owners.add(owner);
    }
  }
  return owners;
}
