import { type MessageInitShape } from "@bufbuild/protobuf";
import {
  type CreatePipelineResolverRequestSchema,
  type CreatePipelineServiceRequestSchema,
  type DeletePipelineResolverRequestSchema,
  type DeletePipelineServiceRequestSchema,
  type UpdatePipelineResolverRequestSchema,
  type UpdatePipelineServiceRequestSchema,
} from "@tailor-platform/tailor-proto/pipeline_pb";
import {
  type PipelineResolver_FieldSchema,
  PipelineResolver_OperationType,
  type PipelineResolver_PipelineSchema,
  type PipelineResolver_TypeSchema,
  PipelineResolverSchema,
} from "@tailor-platform/tailor-proto/pipeline_resource_pb";
import * as inflection from "inflection";
import { type ResolverService } from "#/cli/services/resolver/service";
import { getApplicationAuthNamespace } from "#/cli/shared/auth-namespace";
import { fetchAllTolerant, type OperatorClient } from "#/cli/shared/client";
import {
  assertNoPublishEventsConflict,
  publishEventsConflict,
  resolvePublishEvents,
  subscribesToEvents,
} from "#/cli/shared/publish-events";
import { buildResolverOperationHookExpr } from "#/cli/shared/runtime-exprs";
import { assertDefined } from "#/utils/assert";
import { createChangeSet, type ChangeSet } from "./change-set";
import { areNormalizedEqual, toComparableProtoJson } from "./compare";
import { resolverFunctionName } from "./function-registry";
import {
  formatChangeEntriesWithFunctionRegistry,
  type GroupedDisplayEntry,
  type RelatedFunctionRegistryChanges,
} from "./grouped-display";
import { normalizeInvoker } from "./invoker";
import {
  addDependencyRecords,
  buildMetaRequest,
  type DependentAppsByResource,
  eventSourceKey,
  hasMatchingSdkVersion,
  type MetadataLabelWrite,
  resolverTrn,
  resourceTrn,
  writeMetadataLabels,
} from "./label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "./owned-resource";
import type { ApplyPhase, PlanContext } from "#/cli/commands/deploy/types";
import type { Executor } from "#/types/executor.generated";
import type { TailorField } from "#/types/field.generated";
import type { Resolver } from "#/types/resolver.generated";
import type { OwnerConflict, UnmanagedResource } from "./confirm";

// Scalar type mapping for field type conversion
const SCALAR_TYPE_MAP = {
  uuid: { kind: "ScalarType", name: "ID" },
  string: { kind: "ScalarType", name: "String" },
  integer: { kind: "ScalarType", name: "Int" },
  float: { kind: "ScalarType", name: "Float" },
  decimal: { kind: "CustomScalarType", name: "Decimal" },
  boolean: { kind: "ScalarType", name: "Boolean" },
  date: { kind: "CustomScalarType", name: "Date" },
  datetime: { kind: "CustomScalarType", name: "DateTime" },
  time: { kind: "CustomScalarType", name: "Time" },
} as const satisfies Record<
  Exclude<TailorField["type"], "enum" | "nested">,
  { kind: "ScalarType" | "CustomScalarType"; name: string }
>;

/**
 * Apply resolver pipeline changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned pipeline changes
 * @param phase - Apply phase
 * @returns Promise that resolves when pipeline changes are applied
 */
export async function applyPipeline(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planPipeline>>,
  phase: Exclude<ApplyPhase, "delete"> = "create-update",
) {
  const { changeSet } = result;
  if (phase === "create-update") {
    // Services
    await Promise.all([
      ...changeSet.service.creates.map(async (create) => {
        await client.createPipelineService(create.request);
        await writeMetadataLabels(client, create.metaRequest);
      }),
      ...changeSet.service.updates.map(async (update) => {
        await client.updatePipelineService(update.request);
        await writeMetadataLabels(client, update.metaRequest);
      }),
    ]);

    // Resolvers. An unchanged resolver still gets its labels written, because its
    // dependency records can change while its definition does not.
    await Promise.all([
      ...changeSet.resolver.creates.map(async (create) => {
        await client.createPipelineResolver(create.request);
        await writeMetadataLabels(client, create.metaRequest);
      }),
      ...changeSet.resolver.updates.map(async (update) => {
        await client.updatePipelineResolver(update.request);
        await writeMetadataLabels(client, update.metaRequest);
      }),
      ...changeSet.resolver.unchanged.flatMap((entry) =>
        entry.metaRequest ? [writeMetadataLabels(client, entry.metaRequest)] : [],
      ),
    ]);
  } else if (phase === "delete-resources") {
    // Delete in reverse order of dependencies
    // Resolvers
    await Promise.all(
      changeSet.resolver.deletes.map((del) => client.deletePipelineResolver(del.request)),
    );
  } else {
    // Services only
    await Promise.all(
      changeSet.service.deletes.map((del) => client.deletePipelineService(del.request)),
    );
  }
}

/**
 * Plan resolver pipeline changes based on current and desired state.
 * @param context - Planning context
 * @returns Planned changes
 */
export async function planPipeline(context: PlanContext) {
  const { client, workspaceId, application, forRemoval, forceApplyAll = false } = context;
  const pipelines: Readonly<ResolverService>[] = [];
  if (!forRemoval) {
    for (const pipeline of application.resolverServices) {
      await pipeline.loadResolvers();
      pipelines.push(pipeline);
    }
  }
  const executors = forRemoval
    ? []
    : Object.values((await application.executorService?.loadExecutors()) ?? {});

  const {
    changeSet: serviceChangeSet,
    conflicts,
    unmanaged,
    resourceOwners,
  } = await planServices(client, workspaceId, application.name, application.id, pipelines);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const { changeSet: resolverChangeSet } = await planResolvers(
    client,
    workspaceId,
    pipelines,
    executors,
    context.executorUsedResolvers ?? new Set<string>(),
    deletedServices,
    application.env,
    getApplicationAuthNamespace(application),
    forceApplyAll,
    {
      appName: application.name,
      appId: application.id,
      dependentApps: context.dependentApps,
      runAppIds: context.runAppIds,
    },
  );

  return {
    changeSet: {
      service: serviceChangeSet,
      resolver: resolverChangeSet,
    },
    conflicts,
    unmanaged,
    resourceOwners,
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreatePipelineServiceRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateService = {
  name: string;
  request: MessageInitShape<typeof UpdatePipelineServiceRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeletePipelineServiceRequestSchema>;
};

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  appId: string | undefined,
  pipelines: ReadonlyArray<Readonly<ResolverService>>,
) {
  const changeSet = createChangeSet<CreateService, UpdateService, DeleteService>(
    "Pipeline services",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const existingServices = await fetchExistingResourcesWithLabels({
    client,
    fetchPage: async (pageToken, maxPageSize) => {
      const { pipelineServices, nextPageToken } = await client.listPipelineServices({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [pipelineServices, nextPageToken];
    },
    getName: (resource) => resource.namespace?.name,
    getTrn: (name) => resourceTrn(workspaceId, "pipeline", name),
  });

  for (const pipeline of pipelines) {
    const existing = existingServices[pipeline.namespace];
    const metaRequest = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "pipeline", pipeline.namespace),
      appName,
      appId,
    });
    if (existing) {
      const owned = trackDesiredResourceOwnership({
        labels: existing.allLabels,
        ownerLabel: existing.label,
        appName,
        appId,
        resourceType: "Pipeline service",
        resourceName: pipeline.namespace,
        conflicts,
        unmanaged,
      });

      if (owned && hasMatchingSdkVersion(existing.allLabels, metaRequest.labels)) {
        changeSet.unchanged.push({ name: pipeline.namespace });
      } else {
        changeSet.updates.push({
          name: pipeline.namespace,
          request: {
            workspaceId,
            namespaceName: pipeline.namespace,
          },
          metaRequest,
        });
      }
      delete existingServices[pipeline.namespace];
    } else {
      changeSet.creates.push({
        name: pipeline.namespace,
        request: {
          workspaceId,
          namespaceName: pipeline.namespace,
        },
        metaRequest,
      });
    }
  }
  Object.entries(existingServices).forEach(([namespaceName]) => {
    const entry = existingServices[namespaceName];
    const owned = trackRemainingResourceOwner({
      labels: entry?.allLabels,
      ownerLabel: entry?.label,
      appName,
      appId,
      resourceOwners,
    });
    // Only delete services managed by this application (by name or stable id)
    if (owned) {
      changeSet.deletes.push({
        name: namespaceName,
        request: {
          workspaceId,
          namespaceName,
        },
      });
    }
  });

  return { changeSet, conflicts, unmanaged, resourceOwners };
}

type CreateResolver = {
  name: string;
  request: MessageInitShape<typeof CreatePipelineResolverRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

type UpdateResolver = {
  name: string;
  request: MessageInitShape<typeof UpdatePipelineResolverRequestSchema>;
  metaRequest: MetadataLabelWrite;
};

/**
 * A resolver whose definition is unchanged but whose dependency records are not.
 * The plan shows it as unchanged; apply still writes its labels.
 */
type UnchangedResolver = {
  name: string;
  metaRequest?: MetadataLabelWrite;
};

type DeleteResolver = {
  name: string;
  request: MessageInitShape<typeof DeletePipelineResolverRequestSchema>;
};

/** What planResolvers needs to record dependencies on each resolver. */
type ResolverRecordInputs = {
  appName?: string;
  appId?: string;
  dependentApps?: DependentAppsByResource;
  runAppIds?: ReadonlySet<string>;
};

async function planResolvers(
  client: OperatorClient,
  workspaceId: string,
  pipelines: ReadonlyArray<Readonly<ResolverService>>,
  executors: ReadonlyArray<Executor>,
  initialExecutorUsedResolvers: ReadonlySet<string>,
  deletedServices: ReadonlyArray<string>,
  env: Record<string, string | number | boolean>,
  authNamespace: string | undefined,
  forceApplyAll = false,
  records: ResolverRecordInputs = {},
) {
  const changeSet = createChangeSet<
    CreateResolver,
    UpdateResolver,
    DeleteResolver,
    never,
    UnchangedResolver
  >("Pipeline resolvers");
  const { appName, appId, dependentApps, runAppIds } = records;

  /**
   * Build one resolver's metadata write, carrying the dependency records that
   * belong to it. The resolver is what publishes, so the record lives there.
   * @param namespace - Namespace holding the resolver
   * @param resolver - Resolver being planned
   * @returns The resolver's metadata write
   */
  const resolverMetaRequest = async (
    namespace: string,
    resolver: { name: string; publishEvents?: boolean },
  ) => {
    const trn = resolverTrn(workspaceId, namespace, resolver.name);
    return addDependencyRecords(await buildMetaRequest({ trn, appName: appName ?? "", appId }), {
      key: eventSourceKey.resolver(namespace, resolver.name),
      dependentApps,
      runAppIds,
      pinned: resolver.publishEvents !== undefined,
    });
  };

  const fetchResolvers = (namespaceName: string) => {
    return fetchAllTolerant(async (pageToken, maxPageSize) => {
      const { pipelineResolvers, nextPageToken } = await client.listPipelineResolvers({
        workspaceId,
        namespaceName,
        pageToken,
        pageSize: maxPageSize,
      });
      return [pipelineResolvers, nextPageToken];
    });
  };

  const executorUsedResolvers = new Set(initialExecutorUsedResolvers);
  for (const executor of executors) {
    if (!subscribesToEvents(executor)) continue;
    if (executor.trigger.kind === "resolverExecuted") {
      executorUsedResolvers.add(executor.trigger.resolverName);
    }
  }

  // Reject a conflicting opt-out before any request, not partway through.
  for (const pipeline of pipelines) {
    for (const resolver of Object.values(pipeline.resolvers)) {
      assertNoPublishEventsConflict({
        explicit: resolver.publishEvents,
        subscribed: executorUsedResolvers.has(resolver.name),
        conflict: publishEventsConflict.resolver(resolver.name),
      });
    }
  }

  for (const pipeline of pipelines) {
    const existingResolvers = await fetchResolvers(pipeline.namespace);
    const existingResolversMap = new Map(
      existingResolvers.map((resolver) => [resolver.name, resolver]),
    );
    for (const resolver of Object.values(pipeline.resolvers)) {
      const desiredResolver = processResolver(
        pipeline.namespace,
        resolver,
        executorUsedResolvers,
        env,
        authNamespace,
      );
      const existingResolver = existingResolversMap.get(resolver.name);
      const metaRequest = await resolverMetaRequest(pipeline.namespace, resolver);
      if (existingResolver) {
        const { pipelineResolver: existingResolverDetail } = await client.getPipelineResolver({
          workspaceId,
          namespaceName: pipeline.namespace,
          resolverName: resolver.name,
        });
        if (
          !forceApplyAll &&
          existingResolverDetail &&
          areResolversEqual(existingResolverDetail, desiredResolver)
        ) {
          // The definition matches, but the records may not, so the labels still go.
          changeSet.unchanged.push({ name: resolver.name, metaRequest });
        } else {
          changeSet.updates.push({
            name: resolver.name,
            request: {
              workspaceId,
              namespaceName: pipeline.namespace,
              pipelineResolver: desiredResolver,
            },
            metaRequest,
          });
        }
        existingResolversMap.delete(resolver.name);
      } else {
        changeSet.creates.push({
          name: resolver.name,
          request: {
            workspaceId,
            namespaceName: pipeline.namespace,
            pipelineResolver: desiredResolver,
          },
          metaRequest,
        });
      }
    }
    existingResolversMap.forEach((_resolver, name) => {
      changeSet.deletes.push({
        name,
        request: {
          workspaceId,
          namespaceName: pipeline.namespace,
          resolverName: name,
        },
      });
    });
  }

  for (const namespaceName of deletedServices) {
    const existingResolvers = await fetchResolvers(namespaceName);
    existingResolvers.forEach((resolver) => {
      changeSet.deletes.push({
        name: resolver.name,
        request: {
          workspaceId,
          namespaceName,
          resolverName: resolver.name,
        },
      });
    });
  }
  return { changeSet };
}

type ResolverDisplayEntry = GroupedDisplayEntry;

/**
 * Format resolver changes for grouped dry-run display.
 * @param changeSet - Resolver changes
 * @param resolverFunctionChanges - Related function registry changes for resolvers
 * @returns Display entries for resolver output
 */
export function formatResolverChangeEntries(
  changeSet: Pick<
    ChangeSet<CreateResolver, UpdateResolver, DeleteResolver>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
  resolverFunctionChanges?: RelatedFunctionRegistryChanges,
): ResolverDisplayEntry[] {
  return formatChangeEntriesWithFunctionRegistry(
    "resolver",
    changeSet,
    resolverFunctionChanges,
    (item) => {
      const namespace = item.request.namespaceName;
      return namespace ? [resolverFunctionName(namespace, item.name)] : [];
    },
    {
      getNamespace: (item) => item.request.namespaceName,
    },
  );
}

function normalizeComparableResolver(resolver: MessageInitShape<typeof PipelineResolverSchema>) {
  return toComparableProtoJson(PipelineResolverSchema, resolver);
}

function areResolversEqual(
  existing: MessageInitShape<typeof PipelineResolverSchema>,
  desired: MessageInitShape<typeof PipelineResolverSchema>,
): boolean {
  return areNormalizedEqual(
    normalizeComparableResolver(existing),
    normalizeComparableResolver(desired),
  );
}

function processResolver(
  namespace: string,
  resolver: Resolver,
  executorUsedResolvers: ReadonlySet<string>,
  env: Record<string, string | number | boolean>,
  authNamespace: string | undefined,
): MessageInitShape<typeof PipelineResolverSchema> {
  const pipelines: MessageInitShape<typeof PipelineResolver_PipelineSchema>[] = [
    {
      name: "body",
      operationName: "body",
      description: `${resolver.name} function body`,
      operationType: PipelineResolver_OperationType.FUNCTION,
      operationSourceRef: resolverFunctionName(namespace, resolver.name),
      operationHook: {
        expr: buildResolverOperationHookExpr(env),
      },
      postScript: `args.body`,
      invoker: normalizeInvoker(resolver.invoker, authNamespace, `Resolver "${resolver.name}"`),
    },
  ];

  const typeBaseName = inflection.camelize(resolver.name);

  // Build inputs
  const inputs: MessageInitShape<typeof PipelineResolver_FieldSchema>[] = resolver.input
    ? protoFields(resolver.input, `${typeBaseName}Input`, true)
    : [];

  // Build response
  const response: MessageInitShape<typeof PipelineResolver_FieldSchema> = assertDefined(
    protoFields({ "": resolver.output }, `${typeBaseName}Output`, false)[0],
    "resolver output field missing",
  );

  // Build description (combine resolver description and output description)
  const resolverDescription = resolver.description || `${resolver.name} resolver`;
  const outputDescription = resolver.output.metadata.description;
  const combinedDescription = outputDescription
    ? `${resolverDescription}\n\nReturns:\n${outputDescription}`
    : resolverDescription;

  const publishExecutionEvents = resolvePublishEvents({
    explicit: resolver.publishEvents,
    subscribed: executorUsedResolvers.has(resolver.name),
    conflict: publishEventsConflict.resolver(resolver.name),
  });

  return {
    authorization: "true==true",
    description: combinedDescription,
    inputs,
    name: resolver.name,
    operationType: resolver.operation,
    response,
    pipelines,
    publishExecutionEvents,
  };
}

function protoFields(
  fields: Record<string, TailorField>,
  baseName: string,
  isInput: boolean,
): MessageInitShape<typeof PipelineResolver_FieldSchema>[] {
  return Object.entries(fields).map(([fieldName, field]) => {
    let type: MessageInitShape<typeof PipelineResolver_TypeSchema>;
    const hasCreateHook = isInput && field.metadata.hooks?.create !== undefined;
    const required = hasCreateHook ? false : (field.metadata.required ?? true);

    if (field.type === "nested") {
      const typeName = field.metadata.typeName ?? `${baseName}${inflection.camelize(fieldName)}`;
      type = {
        kind: "UserDefined",
        name: typeName,
        description: field.metadata.description ?? "",
        required,
        fields: protoFields(field.fields, typeName, isInput),
      };
    } else if (field.type === "enum") {
      const typeName = field.metadata.typeName ?? `${baseName}${inflection.camelize(fieldName)}`;
      type = {
        kind: "EnumType",
        name: typeName,
        required,
        allowedValues: field.metadata.allowedValues,
      };
    } else {
      type = { ...SCALAR_TYPE_MAP[field.type], required };
    }

    return {
      name: fieldName,
      description: field.metadata.description,
      array: field.metadata.array ?? false,
      required,
      type,
    };
  });
}
