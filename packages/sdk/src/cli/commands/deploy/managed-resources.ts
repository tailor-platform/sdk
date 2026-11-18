import { logger } from "#/cli/shared/logger";
import { deploymentPlanResults, type PlannedDeployment, type PlanResults } from "./apply-phases";
import { createChangeSet, type HasName } from "./change-set";
import { assertNoDuplicateResourceNames, type ResourceNameCheck } from "./duplicate-resource-names";
import { MANAGED_RESOURCE_LABELS, type ManagedResourceType } from "./managed-resource-type";
import type { ImportantResourceDeletion, OwnerConflict, UnmanagedResource } from "./confirm";
import type { BuiltDeploymentTarget } from "./deployment-target";
import type { OwnershipResult } from "./owned-resource";

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
  assertNoDuplicateResourceNames(
    targets,
    GLOBAL_RESOURCE_NAMES.map((check) => ({
      ...check,
      resourceLabel: MANAGED_RESOURCE_LABELS[check.resourceType],
    })),
  );
}

/**
 * Every `PlanResults` entry carries ownership-tracking fields; deriving the
 * list from `results` itself (instead of naming each key) keeps these
 * collectors in sync with `PlannedDeployment` as resource types are added.
 * @param results - Plan results for a single deployment
 * @returns The ownership-tracking plan entries
 */
function ownershipTrackedPlans(results: PlanResults): ReadonlyArray<OwnershipResult> {
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

type WorkflowJobFunctionItem = { jobFunctionName: string };
type ManagedResourceItem = HasName | WorkflowJobFunctionItem;

type ManagedResourceChangeSet = {
  creates: ManagedResourceItem[];
  updates: ManagedResourceItem[];
  deletes: ManagedResourceItem[];
  replaces: ManagedResourceItem[];
  unchanged: ManagedResourceItem[];
  lines: () => string[];
};

/** Items that carry their requests; `unchanged` ones carry only a name. */
type PlannedItem<C extends ManagedResourceChangeSet> =
  | C["creates"][number]
  | C["updates"][number]
  | C["deletes"][number]
  | C["replaces"][number];

type ManagedResource = {
  changeSetOf: (results: PlanResults) => ManagedResourceChangeSet;
  nameOf?: (item: ManagedResourceItem) => string;
  /** The namespace a planned item belongs to, owned by a resource of type `owner`. */
  namespace?: {
    owner: ManagedResourceType;
    of(item: ManagedResourceItem): string | undefined;
  };
};

/** A `ManagedResource` whose namespace accessor reads the items of change set `C`. */
type ManagedResourceSpec<C extends ManagedResourceChangeSet> = Omit<
  ManagedResource,
  "changeSetOf" | "namespace"
> & {
  changeSetOf: (results: PlanResults) => C;
  namespace?: { owner: ManagedResourceType; of: (item: PlannedItem<C>) => string | undefined };
};

function managedResource<C extends ManagedResourceChangeSet>(
  resource: ManagedResourceSpec<C>,
): ManagedResource {
  return resource;
}

function workflowJobFunctionNames(items: ReadonlyArray<{ usedJobNames: string[] }>): HasName[] {
  return [...new Set(items.flatMap((item) => item.usedJobNames))].map((name) => ({ name }));
}

function workflowJobFunctionChangeSet(results: PlanResults): ManagedResourceChangeSet {
  const { workflow } = results;
  return {
    creates: workflowJobFunctionNames(workflow.changeSet.creates),
    updates: workflowJobFunctionNames(workflow.changeSet.updates),
    replaces: workflowJobFunctionNames(workflow.changeSet.replaces),
    unchanged: [...workflow.unchangedWorkflowJobNames].map((name) => ({ name })),
    deletes: workflow.jobFunctionDeletes,
    lines: () => {
      const display = createChangeSet<HasName, HasName, HasName>("Workflow job functions");
      display.deletes.push(
        ...workflow.jobFunctionDeletes.map((del) => ({ name: del.jobFunctionName })),
      );
      return display.lines();
    },
  };
}

/**
 * Where each resource type's planned changes live in `PlanResults`, and the
 * namespace each planned item belongs to.
 */
export const MANAGED_RESOURCES: Record<ManagedResourceType, ManagedResource> = {
  aigateway: managedResource({ changeSetOf: (results) => results.aiGateway.changeSet }),
  application: managedResource({ changeSetOf: (results) => results.app }),
  "auth.connection": managedResource({
    changeSetOf: (results) => results.auth.changeSet.connection,
  }),
  "auth.hook": managedResource({
    changeSetOf: (results) => results.auth.changeSet.authHook,
    namespace: { owner: "auth.service", of: (item) => item.request.namespaceName },
  }),
  "auth.idp_config": managedResource({
    changeSetOf: (results) => results.auth.changeSet.idpConfig,
    namespace: { owner: "auth.service", of: (item) => item.request.namespaceName },
  }),
  "auth.machine_user": managedResource({
    changeSetOf: (results) => results.auth.changeSet.machineUser,
    namespace: { owner: "auth.service", of: (item) => item.request.authNamespace },
  }),
  "auth.oauth2_client": managedResource({
    changeSetOf: (results) => results.auth.changeSet.oauth2Client,
    namespace: {
      owner: "auth.service",
      of: (item) => ("request" in item ? item.request : item.deleteRequest).namespaceName,
    },
  }),
  "auth.scim": managedResource({
    changeSetOf: (results) => results.auth.changeSet.scim,
    namespace: { owner: "auth.service", of: (item) => item.request.namespaceName },
  }),
  "auth.scim_resource": managedResource({
    changeSetOf: (results) => results.auth.changeSet.scimResource,
    namespace: { owner: "auth.service", of: (item) => item.request.namespaceName },
  }),
  "auth.service": managedResource({ changeSetOf: (results) => results.auth.changeSet.service }),
  "auth.tenant_config": managedResource({
    changeSetOf: (results) => results.auth.changeSet.tenantConfig,
    namespace: { owner: "auth.service", of: (item) => item.request.namespaceName },
  }),
  "auth.user_profile_config": managedResource({
    changeSetOf: (results) => results.auth.changeSet.userProfileConfig,
    namespace: { owner: "auth.service", of: (item) => item.request.namespaceName },
  }),
  executor: managedResource({ changeSetOf: (results) => results.executor.changeSet }),
  function_registry: managedResource({
    changeSetOf: (results) => results.functionRegistry.changeSet,
  }),
  "idp.client": managedResource({
    changeSetOf: (results) => results.idp.changeSet.client,
    namespace: {
      owner: "idp.service",
      of: (item) => ("request" in item ? item.request.namespaceName : item.namespaceName),
    },
  }),
  "idp.service": managedResource({ changeSetOf: (results) => results.idp.changeSet.service }),
  "pipeline.resolver": managedResource({
    changeSetOf: (results) => results.pipeline.changeSet.resolver,
    namespace: { owner: "pipeline.service", of: (item) => item.request.namespaceName },
  }),
  "pipeline.service": managedResource({
    changeSetOf: (results) => results.pipeline.changeSet.service,
  }),
  "secret.secret": managedResource({
    changeSetOf: (results) => results.secretManager.secretChangeSet,
    namespace: { owner: "secret.vault", of: (item) => item.vaultName },
  }),
  "secret.vault": managedResource({
    changeSetOf: (results) => results.secretManager.vaultChangeSet,
  }),
  staticwebsite: managedResource({ changeSetOf: (results) => results.staticWebsite.changeSet }),
  "staticwebsite.custom_domain": managedResource({
    changeSetOf: (results) => results.staticWebsite.customDomainChangeSet,
    namespace: {
      owner: "staticwebsite",
      of: (item) =>
        "request" in item && "staticWebsiteName" in item.request
          ? item.request.staticWebsiteName
          : undefined,
    },
  }),
  "staticwebsite.custom_domain_transfer": managedResource({
    changeSetOf: (results) => results.staticWebsite.customDomainTransferChangeSet,
  }),
  "tailordb.gql_permission": managedResource({
    changeSetOf: (results) => results.tailorDB.changeSet.gqlPermission,
    namespace: { owner: "tailordb.service", of: (item) => item.request.namespaceName },
  }),
  "tailordb.service": managedResource({
    changeSetOf: (results) => results.tailorDB.changeSet.service,
  }),
  "tailordb.type": managedResource({
    changeSetOf: (results) => results.tailorDB.changeSet.type,
    namespace: { owner: "tailordb.service", of: (item) => item.request.namespaceName },
  }),
  workflow: managedResource({ changeSetOf: (results) => results.workflow.changeSet }),
  workflow_job_function: managedResource({
    changeSetOf: workflowJobFunctionChangeSet,
    nameOf: (item) => ("jobFunctionName" in item ? item.jobFunctionName : item.name),
  }),
  workflow_job_function_execution_policy: managedResource({
    changeSetOf: (results) => results.workflowExecutionPolicy.changeSet,
  }),
};

/**
 * Read the namespace of a planned item of a resource type.
 * @param resourceType - Resource type of the item
 * @returns Namespace of a created, updated, deleted, or replaced item, if the type has one
 */
export function plannedNamespaceOf(
  resourceType: ManagedResourceType,
): (item: ManagedResourceItem) => string | undefined {
  const { namespace } = MANAGED_RESOURCES[resourceType];
  return (item) => namespace?.of(item);
}

function managedResourceName(resource: ManagedResource, item: ManagedResourceItem): string {
  return resource.nameOf ? resource.nameOf(item) : (item as HasName).name;
}

function deletesNeedingConfirmation(
  results: PlanResults,
  resourceType: ManagedResourceType,
): ImportantResourceDeletion[] {
  const resource = MANAGED_RESOURCES[resourceType];
  return resource.changeSetOf(results).deletes.map((item) => ({
    resourceLabel: MANAGED_RESOURCE_LABELS[resourceType],
    resourceName: managedResourceName(resource, item),
  }));
}

export function collectImportantResourceDeletions(
  results: PlanResults,
): ImportantResourceDeletion[] {
  const { app } = results;
  const keepsApplication = app.creates.length + app.updates.length + app.unchanged.length > 0;
  return [
    ...deletesNeedingConfirmation(results, "tailordb.type"),
    ...deletesNeedingConfirmation(results, "staticwebsite"),
    ...deletesNeedingConfirmation(results, "aigateway"),
    ...deletesNeedingConfirmation(results, "auth.oauth2_client"),
    ...results.auth.changeSet.oauth2Client.replaces.map((replace) => ({
      resourceLabel: `${MANAGED_RESOURCE_LABELS["auth.oauth2_client"]} (client type change)`,
      resourceName: replace.name,
    })),
    ...deletesNeedingConfirmation(results, "auth.connection"),
    ...deletesNeedingConfirmation(results, "secret.vault"),
    ...deletesNeedingConfirmation(results, "secret.secret"),
    ...(keepsApplication ? [] : deletesNeedingConfirmation(results, "application")),
  ];
}

type ManagedResourceGroup = ManagedResource & {
  resourceType: ManagedResourceType;
  changeSet: ManagedResourceChangeSet;
};

function managedResourceKey(
  group: ManagedResourceGroup,
  item: ManagedResourceItem,
  namespace: string | undefined,
): string {
  const name = managedResourceName(group, item);
  return namespace !== undefined
    ? `${group.resourceType}:${namespace}:${name}`
    : `${group.resourceType}:${name}`;
}

function managedNamespaceOwnerKey(
  group: ManagedResourceGroup,
  namespace: string | undefined,
): string | undefined {
  return group.namespace && namespace !== undefined
    ? `${group.namespace.owner}:${namespace}`
    : undefined;
}

function addManagedResourceClaims(
  claims: Set<string>,
  group: ManagedResourceGroup,
  item: ManagedResourceItem,
  namespace: string | undefined,
): void {
  claims.add(managedResourceKey(group, item, namespace));
  const namespaceOwnerKey = managedNamespaceOwnerKey(group, namespace);
  if (namespaceOwnerKey) {
    claims.add(namespaceOwnerKey);
  }
}

function retainDeletesNotClaimed(
  group: ManagedResourceGroup,
  otherClaims: ReadonlySet<string>,
): void {
  let writeIndex = 0;
  for (const item of group.changeSet.deletes) {
    const namespace = group.namespace?.of(item);
    const key = managedResourceKey(group, item, namespace);
    const namespaceOwnerKey = managedNamespaceOwnerKey(group, namespace);
    if (otherClaims.has(key) || (namespaceOwnerKey && otherClaims.has(namespaceOwnerKey))) {
      logger.debug(`Skipping delete of ${key}: still managed by another config in this deploy.`);
      continue;
    }
    group.changeSet.deletes[writeIndex] = item;
    writeIndex += 1;
  }
  group.changeSet.deletes.length = writeIndex;
}

/**
 * Resource types whose names are workspace-global (the TRN is not qualified by
 * a namespace or an application), with the names each config defines.
 */
const GLOBAL_RESOURCE_NAMES: ReadonlyArray<
  Pick<ResourceNameCheck, "namesOf"> & { resourceType: ManagedResourceType }
> = [
  { resourceType: "application", namesOf: (target) => [target.application.name] },
  {
    resourceType: "executor",
    namesOf: (target) =>
      Object.values(target.application.executorService?.executors ?? {}).map(
        (executor) => executor.name,
      ),
  },
  {
    resourceType: "workflow_job_function",
    namesOf: (target) => target.bundledScripts.workflowJobs.keys(),
  },
  {
    resourceType: "workflow",
    namesOf: (target) =>
      Object.values(target.application.workflowService?.workflows ?? {}).map(
        (workflow) => workflow.name,
      ),
  },
  {
    resourceType: "workflow_job_function_execution_policy",
    namesOf: (target) =>
      Object.values(target.config.workflow?.executionPolicies ?? {}).map((policy) => policy.name),
  },
  {
    resourceType: "auth.connection",
    namesOf: (target) => Object.keys(target.application.authService?.connections ?? {}),
  },
  {
    resourceType: "staticwebsite",
    namesOf: (target) => target.application.staticWebsiteServices.map((service) => service.name),
  },
  {
    resourceType: "tailordb.service",
    namesOf: (target) => target.application.tailorDBServices.map((service) => service.namespace),
  },
  {
    resourceType: "auth.service",
    namesOf: (target) => {
      const name = target.application.authService?.config.name;
      return name === undefined ? [] : [name];
    },
  },
  {
    resourceType: "idp.service",
    namesOf: (target) => target.application.idpServices.map((idp) => idp.name),
  },
  {
    resourceType: "pipeline.service",
    namesOf: (target) => target.application.resolverServices.map((service) => service.namespace),
  },
  {
    resourceType: "aigateway",
    namesOf: (target) => target.application.aiGatewayServices.map((service) => service.name),
  },
  {
    resourceType: "secret.vault",
    namesOf: (target) => target.application.secrets.map((vault) => vault.vaultName),
  },
];

// A transfer is planned only for a domain of a site its own config defines.
const NOT_CLAIMED_ACROSS_CONFIGS: ReadonlySet<ManagedResourceType> = new Set([
  "staticwebsite.custom_domain_transfer",
]);

function managedResourceGroups(results: PlanResults): ManagedResourceGroup[] {
  return (Object.keys(MANAGED_RESOURCES) as ManagedResourceType[])
    .filter((resourceType) => !NOT_CLAIMED_ACROSS_CONFIGS.has(resourceType))
    .map((resourceType) => ({
      ...MANAGED_RESOURCES[resourceType],
      resourceType,
      changeSet: MANAGED_RESOURCES[resourceType].changeSetOf(results),
    }));
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
      ]) {
        addManagedResourceClaims(claims, group, item, group.namespace?.of(item));
      }
      for (const item of group.changeSet.unchanged) {
        addManagedResourceClaims(claims, group, item, undefined);
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

function collectDeploymentResourceOwners(
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

/**
 * Append a delete to `app.deletes` for each application that taking over its
 * resources leaves empty (see `computeRenamedAppDeletions`), unless a
 * deployment already deletes it.
 * @param deployments - Planned deployments of this run
 */
export function scheduleRenamedAppDeletes(deployments: ReadonlyArray<PlannedDeployment>): void {
  const protectedAppNames = new Set(deployments.map((deployment) => deployment.application.name));
  const resourceOwners = collectDeploymentResourceOwners(deployments);
  const scheduled = new Set(
    deployments.flatMap((deployment) => deployment.app.deletes.map((del) => del.name)),
  );

  for (const deployment of deployments) {
    const conflicts = collectOwnerConflicts(deploymentPlanResults(deployment));
    for (const name of computeRenamedAppDeletions({
      conflicts,
      resourceOwners,
      protectedAppNames,
    })) {
      if (scheduled.has(name)) {
        continue;
      }
      scheduled.add(name);
      deployment.app.deletes.push({
        name,
        request: {
          workspaceId: deployment.tailorDB.context.workspaceId,
          applicationName: name,
        },
      });
    }
  }
}
