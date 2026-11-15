import { Subgraph_ServiceType } from "@tailor-platform/tailor-proto/application_resource_pb";
import { PipelineResolverView } from "@tailor-platform/tailor-proto/pipeline_pb";
import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import { CLIError } from "#/cli/shared/errors";
import { protoSubgraph } from "./application";
import { sdkNameLabelKey } from "./label";
import type { PlannedDeployment } from "./apply-phases";
import type { ManagedResourceType } from "./managed-resource-type";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { AuthInvokerSchema } from "@tailor-platform/tailor-proto/auth_resource_pb";
import type { ExecutorExecutorSchema } from "@tailor-platform/tailor-proto/executor_resource_pb";
import type { PipelineResolverSchema } from "@tailor-platform/tailor-proto/pipeline_resource_pb";

type ResourceDeletePlan = Pick<
  PlannedDeployment,
  | "application"
  | "app"
  | "auth"
  | "tailorDB"
  | "pipeline"
  | "idp"
  | "executor"
  | "aiGateway"
  | "workflow"
>;

type CheckedResourceType = Extract<
  ManagedResourceType,
  | "auth.service"
  | "tailordb.service"
  | "pipeline.service"
  | "idp.service"
  | "auth.machine_user"
  | "tailordb.type"
  | "pipeline.resolver"
  | "workflow"
>;

type ResourceKey<T extends ManagedResourceType> = {
  resourceType: T;
  namespace?: string;
  name: string;
};

type ResourceRef = ResourceKey<CheckedResourceType>;

type CheckedResource = {
  label: (ref: ResourceRef) => string;
  deletesOf: (plan: ResourceDeletePlan) => ReadonlyArray<Omit<ResourceRef, "resourceType">>;
};

const CHECKED_RESOURCES: Record<CheckedResourceType, CheckedResource> = {
  "auth.service": {
    label: ({ name }) => `Auth service "${name}"`,
    deletesOf: (plan) => plan.auth.changeSet.service.deletes,
  },
  "tailordb.service": {
    label: ({ name }) => `TailorDB namespace "${name}"`,
    deletesOf: (plan) => plan.tailorDB.changeSet.service.deletes,
  },
  "pipeline.service": {
    label: ({ name }) => `Resolver namespace "${name}"`,
    deletesOf: (plan) => plan.pipeline.changeSet.service.deletes,
  },
  "idp.service": {
    label: ({ name }) => `IdP service "${name}"`,
    deletesOf: (plan) => plan.idp.changeSet.service.deletes,
  },
  "auth.machine_user": {
    label: ({ namespace, name }) => `Machine user "${name}" of Auth service "${namespace}"`,
    deletesOf: (plan) =>
      plan.auth.changeSet.machineUser.deletes.map(({ name, request }) => ({
        namespace: request.authNamespace,
        name,
      })),
  },
  "tailordb.type": {
    label: ({ namespace, name }) => `TailorDB table "${name}" in namespace "${namespace}"`,
    deletesOf: (plan) =>
      plan.tailorDB.changeSet.type.deletes.map(({ name, request }) => ({
        namespace: request.namespaceName,
        name,
      })),
  },
  "pipeline.resolver": {
    label: ({ namespace, name }) => `Resolver "${name}" in namespace "${namespace}"`,
    deletesOf: (plan) =>
      plan.pipeline.changeSet.resolver.deletes.map(({ name, request }) => ({
        namespace: request.namespaceName,
        name,
      })),
  },
  workflow: {
    label: ({ name }) => `Workflow "${name}"`,
    deletesOf: (plan) => plan.workflow.changeSet.deletes,
  },
};

type UserResourceType = Extract<
  ManagedResourceType,
  "executor" | "pipeline.resolver" | "aigateway"
>;

type ResourceUser = ResourceKey<UserResourceType>;

const USER_LABELS: Record<UserResourceType, (user: ResourceUser) => string> = {
  executor: ({ name }) => `executor "${name}"`,
  "pipeline.resolver": ({ namespace, name }) => `resolver "${name}" in namespace "${namespace}"`,
  aigateway: ({ name }) => `AI gateway "${name}"`,
};

type ResourceUse = ResourceRef & {
  /** Application that uses the resource, absent for a user no application manages. */
  application?: string;
  /** Resource that uses it, absent when the application itself references it. */
  usedBy?: ResourceUser;
};

type ResourceDeletingCommand = "deploy" | "remove";

const IN_USE_SUGGESTIONS: Record<ResourceDeletingCommand, string> = {
  deploy:
    "Keep each listed resource in the config that defines it, or deploy the applications that use it so that they stop using it, first or in the same run.",
  remove:
    "Remove the applications that use each listed resource, or deploy them so that they stop using it, then run remove again.",
};

const UNMANAGED_USER_SUGGESTION =
  "An executor, resolver, or AI gateway listed without an application is not deployed by the SDK, so change or delete it outside the SDK.";

const SUBGRAPH_RESOURCE_TYPES = new Map<Subgraph_ServiceType, CheckedResourceType>([
  [Subgraph_ServiceType.TAILORDB, "tailordb.service"],
  [Subgraph_ServiceType.PIPELINE, "pipeline.service"],
  [Subgraph_ServiceType.IDP, "idp.service"],
]);

function refKey(ref: ResourceKey<ManagedResourceType>): string {
  return JSON.stringify([ref.resourceType, ref.namespace ?? "", ref.name]);
}

function servicesOf(
  authNamespace: string | undefined,
  subgraphs: ReadonlyArray<ReturnType<typeof protoSubgraph>>,
): ResourceRef[] {
  const auth: ResourceRef[] = authNamespace
    ? [{ resourceType: "auth.service", name: authNamespace }]
    : [];
  const subgraphServices = subgraphs.flatMap(({ serviceType, serviceNamespace }) => {
    const resourceType = SUBGRAPH_RESOURCE_TYPES.get(serviceType);
    return resourceType ? [{ resourceType, name: serviceNamespace }] : [];
  });
  return [...auth, ...subgraphServices];
}

function applicationUses(deployments: ReadonlyArray<ResourceDeletePlan>): ResourceUse[] {
  const written = new Set(
    deployments.flatMap(({ app }) =>
      [...app.creates, ...app.updates, ...app.unchanged].map((entry) => entry.name),
    ),
  );
  const deletedNames = new Set(
    deployments.flatMap(({ app }) => app.deletes.map((entry) => entry.name)),
  );
  const writtenUses = deployments.flatMap(({ application }) =>
    written.has(application.name)
      ? servicesOf(
          getApplicationAuthNamespace(application),
          application.subgraphs.map(protoSubgraph),
        ).map((service) => ({ ...service, application: application.name }))
      : [],
  );
  const recorded = new Map(
    deployments
      .flatMap(({ app }) => app.existingApplications)
      .map((existing) => [existing.name, existing]),
  );
  const recordedUses = [...recorded.values()]
    .filter((existing) => !written.has(existing.name) && !deletedNames.has(existing.name))
    .flatMap((existing) =>
      servicesOf(existing.authNamespace, existing.subgraphs).map((service) => ({
        ...service,
        application: existing.name,
      })),
    );
  return [...writtenUses, ...recordedUses];
}

/** A resource that uses others, in the version the workspace has after the run. */
type FinalUser<T> = {
  resource: T;
  name: string;
  namespace?: string;
  application: string | undefined;
};

function finalUsers<T>(
  planned: ReadonlyArray<FinalUser<T>>,
  deleted: ReadonlyArray<{ name: string }>,
  recorded: ReadonlyArray<
    [string, { resource: T; allLabels?: Record<string, string> } | undefined]
  >,
): FinalUser<T>[] {
  const rewritten = new Set([...planned, ...deleted].map(({ name }) => name));
  const kept = new Map(
    recorded.flatMap(([name, entry]) =>
      entry && !rewritten.has(name)
        ? [
            [
              name,
              { resource: entry.resource, name, application: entry.allLabels?.[sdkNameLabelKey] },
            ],
          ]
        : [],
    ),
  );
  return [...planned, ...kept.values()];
}

function invokerRefs(
  invoker: MessageInitShape<typeof AuthInvokerSchema> | undefined,
): ResourceRef[] {
  return invoker?.namespace && invoker.machineUserName
    ? [
        {
          resourceType: "auth.machine_user",
          namespace: invoker.namespace,
          name: invoker.machineUserName,
        },
      ]
    : [];
}

function executorRefs(executor: MessageInitShape<typeof ExecutorExecutorSchema>): ResourceRef[] {
  const refs: ResourceRef[] = [];
  const trigger = executor.triggerConfig?.config;
  const typed = trigger?.case === "event" ? trigger.value.typedConfig : undefined;
  switch (typed?.case) {
    case "tailordb":
      refs.push({
        resourceType: "tailordb.type",
        namespace: typed.value.namespaceName,
        name: typed.value.typeName ?? "",
      });
      break;
    case "pipeline":
      refs.push({
        resourceType: "pipeline.resolver",
        namespace: typed.value.namespaceName,
        name: typed.value.resolverName ?? "",
      });
      break;
    case "idp":
      refs.push({ resourceType: "idp.service", name: typed.value.namespaceName ?? "" });
      break;
    case "workflow":
      refs.push({ resourceType: "workflow", name: typed.value.workflowName ?? "" });
      break;
    case "auth":
    case undefined:
      break;
  }
  const target = executor.targetConfig?.config;
  switch (target?.case) {
    case "function":
    case "tailorGraphql":
      refs.push(...invokerRefs(target.value.invoker));
      break;
    case "workflow":
      refs.push({ resourceType: "workflow", name: target.value.workflowName ?? "" });
      refs.push(...invokerRefs(target.value.invoker));
      break;
    case "webhook":
    case undefined:
      break;
  }
  return refs;
}

function executorUses(deployments: ReadonlyArray<ResourceDeletePlan>): ResourceUse[] {
  const planned = deployments.flatMap(({ application, executor }) =>
    [...executor.changeSet.creates, ...executor.changeSet.updates].map((entry) => ({
      resource: entry.request.executor ?? {},
      name: entry.name,
      application: application.name,
    })),
  );
  return finalUsers<MessageInitShape<typeof ExecutorExecutorSchema>>(
    planned,
    deployments.flatMap(({ executor }) => executor.changeSet.deletes),
    deployments.flatMap(({ executor }) => Object.entries(executor.existingExecutors)),
  ).flatMap(({ resource, name, application }) =>
    executorRefs(resource).map((ref) => ({
      ...ref,
      ...(application ? { application } : {}),
      usedBy: { resourceType: "executor" as const, name },
    })),
  );
}

function aiGatewayUses(deployments: ReadonlyArray<ResourceDeletePlan>): ResourceUse[] {
  const planned = deployments.flatMap(({ application, aiGateway }) =>
    [...aiGateway.changeSet.creates, ...aiGateway.changeSet.updates].map((entry) => ({
      resource: { authNamespace: entry.request.authNamespace },
      name: entry.name,
      application: application.name,
    })),
  );
  return finalUsers<{ authNamespace?: string }>(
    planned,
    deployments.flatMap(({ aiGateway }) => aiGateway.changeSet.deletes),
    deployments.flatMap(({ aiGateway }) => Object.entries(aiGateway.existingGateways)),
  ).flatMap(({ resource, name, application }) =>
    resource.authNamespace
      ? [
          {
            resourceType: "auth.service" as const,
            name: resource.authNamespace,
            ...(application ? { application } : {}),
            usedBy: { resourceType: "aigateway" as const, name },
          },
        ]
      : [],
  );
}

type ResolverUsesParams = {
  deployments: ReadonlyArray<ResourceDeletePlan>;
  client: OperatorClient;
  workspaceId: string;
};

async function resolverUses(params: ResolverUsesParams): Promise<ResourceUse[]> {
  const { deployments, client, workspaceId } = params;
  const resolverKey = (namespace: string | undefined, name: string) =>
    refKey({ resourceType: "pipeline.resolver", namespace, name });
  const planned = deployments.flatMap(({ application, pipeline }) =>
    [...pipeline.changeSet.resolver.creates, ...pipeline.changeSet.resolver.updates].map(
      (entry) => ({
        resource: entry.request.pipelineResolver ?? {},
        name: entry.name,
        namespace: entry.request.namespaceName,
        application: application.name,
      }),
    ),
  );
  const rewritten = new Set([
    ...planned.map(({ namespace, name }) => resolverKey(namespace, name)),
    ...deployments.flatMap(({ pipeline }) =>
      pipeline.changeSet.resolver.deletes.map(({ name, request }) =>
        resolverKey(request.namespaceName, name),
      ),
    ),
  ]);
  const deletedNamespaces = new Set(
    deployments.flatMap(({ pipeline }) =>
      pipeline.changeSet.service.deletes.map(({ name }) => name),
    ),
  );
  const kept = deployments.flatMap(({ application, pipeline }) =>
    [...pipeline.existingResolvers].flatMap(([namespace, { existingResolverDetails }]) =>
      deletedNamespaces.has(namespace)
        ? []
        : [...existingResolverDetails].flatMap(([name, resource]) =>
            resource && !rewritten.has(resolverKey(namespace, name))
              ? [{ resource, name, namespace, application: application.name }]
              : [],
          ),
    ),
  );
  const runNamespaces = new Set(
    deployments.flatMap(({ pipeline }) => [...pipeline.existingResolvers.keys()]),
  );
  const otherServices = new Map(
    deployments
      .flatMap(({ pipeline }) => Object.entries(pipeline.existingServices))
      .filter(([namespace]) => !runNamespaces.has(namespace)),
  );
  const others = await Promise.all(
    [...otherServices].map(async ([namespace, service]) => {
      const resolvers = await fetchAllTolerant(async (pageToken, maxPageSize) => {
        const { pipelineResolvers, nextPageToken } = await client.listPipelineResolvers({
          workspaceId,
          namespaceName: namespace,
          pipelineResolverView: PipelineResolverView.FULL,
          pageToken,
          pageSize: maxPageSize,
        });
        return [pipelineResolvers, nextPageToken];
      });
      return resolvers.map((resource) => ({
        resource,
        name: resource.name,
        namespace,
        application: service?.allLabels?.[sdkNameLabelKey],
      }));
    }),
  );
  const resolvers: FinalUser<MessageInitShape<typeof PipelineResolverSchema>>[] = [
    ...planned,
    ...kept,
    ...others.flat(),
  ];
  return resolvers.flatMap(({ resource, name, namespace, application }) =>
    (resource.pipelines ?? [])
      .flatMap((step) => invokerRefs(step.invoker))
      .map((ref) => ({
        ...ref,
        ...(application ? { application } : {}),
        usedBy: { resourceType: "pipeline.resolver" as const, namespace, name },
      })),
  );
}

function describeUse(use: ResourceUse): string {
  const user = use.usedBy
    ? `${USER_LABELS[use.usedBy.resourceType](use.usedBy)}${use.application ? ` of application "${use.application}"` : ""}`
    : `application "${use.application}"`;
  return `${CHECKED_RESOURCES[use.resourceType].label(use)} cannot be deleted: ${user} still uses it.`;
}

type AssertResourcesNotInUseParams = {
  /** Planned deployments of a deploy run, or the plan of a removal. */
  deployments: ReadonlyArray<ResourceDeletePlan>;
  /** Command whose run deletes the resources. */
  command: ResourceDeletingCommand;
  client: OperatorClient;
  workspaceId: string;
};

/**
 * Reject a run that deletes a resource another application still uses: an Auth service,
 * TailorDB namespace, resolver namespace, or IdP that an application references, an Auth
 * service that an AI gateway authenticates against, a machine user that an executor or resolver
 * runs as, or a TailorDB table, resolver, IdP, or workflow that an executor subscribes to or runs.
 * A resource the plan writes counts by its planned version, a resource it deletes does not count,
 * and any other counts by the workspace's record. When the run spans several configs, call it
 * after deletes that another config in the run still claims are dropped and deletes of renamed
 * applications are scheduled.
 * @param params - The run's plans, its command, and the workspace they apply to
 */
export async function assertResourcesNotInUse(
  params: AssertResourcesNotInUseParams,
): Promise<void> {
  const { deployments, command, client, workspaceId } = params;
  const deleted = new Set(
    deployments.flatMap((plan) =>
      Object.entries(CHECKED_RESOURCES).flatMap(([resourceType, { deletesOf }]) =>
        deletesOf(plan).map((resource) =>
          refKey({ ...resource, resourceType: resourceType as CheckedResourceType }),
        ),
      ),
    ),
  );
  if (deleted.size === 0) return;
  const deletesMachineUser = deployments.some(
    ({ auth }) => auth.changeSet.machineUser.deletes.length > 0,
  );
  const allUses = [
    ...applicationUses(deployments),
    ...executorUses(deployments),
    ...(deletesMachineUser ? await resolverUses({ deployments, client, workspaceId }) : []),
    ...aiGatewayUses(deployments),
  ];
  const uses = [
    ...new Map(
      allUses.filter((use) => deleted.has(refKey(use))).map((use) => [describeUse(use), use]),
    ).values(),
  ];
  if (uses.length === 0) return;
  throw CLIError({
    code: "SERVICE_IN_USE",
    message: uses.map(describeUse).join("\n"),
    suggestion: uses.every((use) => use.application)
      ? IN_USE_SUGGESTIONS[command]
      : `${IN_USE_SUGGESTIONS[command]} ${UNMANAGED_USER_SUGGESTION}`,
    context: { uses },
  });
}
