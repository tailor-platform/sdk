import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type CreatePipelineResolverRequestSchema,
  type CreatePipelineServiceRequestSchema,
  type DeletePipelineResolverRequestSchema,
  type DeletePipelineServiceRequestSchema,
  type UpdatePipelineResolverRequestSchema,
  type UpdatePipelineServiceRequestSchema,
} from "@tailor-proto/tailor/v1/pipeline_pb";
import {
  type PipelineResolver_FieldSchema,
  PipelineResolver_OperationType,
  type PipelineResolver_PipelineSchema,
  type PipelineResolver_TypeSchema,
  type PipelineResolverSchema,
} from "@tailor-proto/tailor/v1/pipeline_resource_pb";
import * as inflection from "inflection";
import { type ResolverService } from "@/cli/services/resolver/service";
import { fetchAll, type OperatorClient } from "@/cli/shared/client";
import { logger, styles } from "@/cli/shared/logger";
import { buildResolverOperationHookExpr } from "@/cli/shared/runtime-args";
import { createChangeSet, type ChangeSet, type HasName } from "./change-set";
import { areNormalizedEqual, formatPropertyDiffLines, normalizeProtoConfig } from "./compare";
import { resolverFunctionName } from "./function-registry";
import {
  actionSymbol,
  buildRemainingFunctionRegistryEntries,
  createRelatedFunctionRegistryNameSets,
  formatActionDetailLine,
  formatScriptAddedLine,
  formatScriptChangedLine,
  type GroupedDisplayEntry,
  type RelatedFunctionRegistryNameSets,
  type RelatedFunctionRegistryChanges,
} from "./grouped-display";
import { buildMetaRequest, hasMatchingSdkVersion, sdkNameLabelKey, type WithLabel } from "./label";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase, PlanContext } from "@/cli/commands/apply/apply";
import type { Executor } from "@/types/executor.generated";
import type { Resolver, TailorField } from "@/types/resolver.generated";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

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
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.service.updates.map(async (update) => {
        await client.updatePipelineService(update.request);
        await client.setMetadata(update.metaRequest);
      }),
    ]);

    // Resolvers
    await Promise.all([
      ...changeSet.resolver.creates.map((create) => client.createPipelineResolver(create.request)),
      ...changeSet.resolver.updates.map((update) => client.updatePipelineResolver(update.request)),
    ]);
  } else if (phase === "delete-resources") {
    // Delete in reverse order of dependencies
    // Resolvers
    await Promise.all(
      changeSet.resolver.deletes.map((del) => client.deletePipelineResolver(del.request)),
    );
  } else if (phase === "delete-services") {
    // Services only
    await Promise.all(
      changeSet.service.deletes.map((del) => client.deletePipelineService(del.request)),
    );
  }
}

/**
 * Plan resolver pipeline changes based on current and desired state.
 * @param context - Planning context
 * @param functionRegistryResolverChanges - Related function registry changes for resolvers
 * @param detailPlan - Whether to print detailed property-level changes
 * @returns Planned changes
 */
export async function planPipeline(
  context: PlanContext,
  functionRegistryResolverChanges?: RelatedFunctionRegistryChanges,
  detailPlan = false,
) {
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
  } = await planServices(client, workspaceId, application.name, pipelines);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const resolverChangeSet = await planResolvers(
    client,
    workspaceId,
    pipelines,
    executors,
    deletedServices,
    application.env,
    forceApplyAll,
  );

  serviceChangeSet.print(detailPlan);
  printResolverChanges(resolverChangeSet, functionRegistryResolverChanges, detailPlan);
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
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateService = {
  name: string;
  request: MessageInitShape<typeof UpdatePipelineServiceRequestSchema>;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeletePipelineServiceRequestSchema>;
};

function trn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:pipeline:${name}`;
}

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  pipelines: ReadonlyArray<Readonly<ResolverService>>,
) {
  const changeSet = createChangeSet<CreateService, UpdateService, DeleteService>(
    "Pipeline services",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const withoutLabel = await fetchAll(async (pageToken, maxPageSize) => {
    try {
      const { pipelineServices, nextPageToken } = await client.listPipelineServices({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [pipelineServices, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });
  const existingServices: WithLabel<(typeof withoutLabel)[number]> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      if (!resource.namespace?.name) {
        return;
      }
      const { metadata } = await client.getMetadata({
        trn: trn(workspaceId, resource.namespace.name),
      });
      existingServices[resource.namespace.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
        allLabels: metadata?.labels,
      };
    }),
  );

  for (const pipeline of pipelines) {
    const existing = existingServices[pipeline.namespace];
    const metaRequest = await buildMetaRequest(trn(workspaceId, pipeline.namespace), appName);
    if (existing) {
      if (!existing.label) {
        unmanaged.push({
          resourceType: "Pipeline service",
          resourceName: pipeline.namespace,
        });
      } else if (existing.label !== appName) {
        conflicts.push({
          resourceType: "Pipeline service",
          resourceName: pipeline.namespace,
          currentOwner: existing.label,
        });
      }

      if (
        existing.label === appName &&
        hasMatchingSdkVersion(existing.allLabels, metaRequest.labels)
      ) {
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
    const label = existingServices[namespaceName]?.label;
    if (label && label !== appName) {
      resourceOwners.add(label);
    }
    // Only delete services managed by this application
    if (label === appName) {
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
  detailLines?: string[];
  request: MessageInitShape<typeof CreatePipelineResolverRequestSchema>;
};

type UpdateResolver = {
  name: string;
  detailLines?: string[];
  request: MessageInitShape<typeof UpdatePipelineResolverRequestSchema>;
};

type DeleteResolver = {
  name: string;
  request: MessageInitShape<typeof DeletePipelineResolverRequestSchema>;
};

async function planResolvers(
  client: OperatorClient,
  workspaceId: string,
  pipelines: ReadonlyArray<Readonly<ResolverService>>,
  executors: ReadonlyArray<Executor>,
  deletedServices: ReadonlyArray<string>,
  env: Record<string, string | number | boolean>,
  forceApplyAll = false,
) {
  const changeSet = createChangeSet<CreateResolver, UpdateResolver, DeleteResolver>(
    "Pipeline resolvers",
  );

  const fetchResolvers = (namespaceName: string) => {
    return fetchAll(async (pageToken, maxPageSize) => {
      try {
        const { pipelineResolvers, nextPageToken } = await client.listPipelineResolvers({
          workspaceId,
          namespaceName,
          pageToken,
          pageSize: maxPageSize,
        });
        return [pipelineResolvers, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });
  };

  const executorUsedResolvers = new Set<string>();
  for (const executor of executors) {
    if (executor.trigger.kind === "resolverExecuted") {
      executorUsedResolvers.add(executor.trigger.resolverName);
    }
  }

  // Validate that resolvers used by executors don't have publishEvents explicitly set to false
  for (const pipeline of pipelines) {
    for (const resolver of Object.values(pipeline.resolvers)) {
      if (executorUsedResolvers.has(resolver.name) && resolver.publishEvents === false) {
        throw new Error(
          `Resolver "${resolver.name}" has publishEvents set to false, but it is used by an executor with a resolverExecuted trigger. ` +
            `Either remove the publishEvents: false setting or remove the executor trigger for this resolver.`,
        );
      }
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
      );
      const existingResolver = existingResolversMap.get(resolver.name);
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
          changeSet.unchanged.push({ name: resolver.name });
        } else {
          changeSet.updates.push({
            name: resolver.name,
            detailLines:
              existingResolverDetail == null
                ? undefined
                : formatPropertyDiffLines(
                    normalizeComparableResolver(existingResolverDetail),
                    normalizeComparableResolver(desiredResolver),
                  ),
            request: {
              workspaceId,
              namespaceName: pipeline.namespace,
              pipelineResolver: desiredResolver,
            },
          });
        }
        existingResolversMap.delete(resolver.name);
      } else {
        changeSet.creates.push({
          name: resolver.name,
          detailLines: formatResolverCreateDetailLines(desiredResolver, resolver.operation),
          request: {
            workspaceId,
            namespaceName: pipeline.namespace,
            pipelineResolver: desiredResolver,
          },
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
  return changeSet;
}

type ResolverDisplayEntry = GroupedDisplayEntry;

function formatResolverFunctionName(namespace: string | undefined, resolverName: string) {
  return namespace ? resolverFunctionName(namespace, resolverName) : undefined;
}

/**
 * Format resolver changes for grouped dry-run display.
 * @param changeSet - Resolver changes
 * @param resolverFunctionChanges - Related function registry changes for resolvers
 * @param resolverFunctionChanges.creates - Function registry creations
 * @param resolverFunctionChanges.updates - Function registry updates
 * @param resolverFunctionChanges.deletes - Function registry deletions
 * @param resolverFunctionChanges.replaces - Function registry replacements
 * @returns Display entries for resolver output
 */
export function formatResolverChangeEntries(
  changeSet: Pick<
    ChangeSet<CreateResolver, UpdateResolver, DeleteResolver>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
  resolverFunctionChanges?: RelatedFunctionRegistryChanges,
): ResolverDisplayEntry[] {
  const functionNames = createRelatedFunctionRegistryNameSets(resolverFunctionChanges);
  const consumed: RelatedFunctionRegistryNameSets = createRelatedFunctionRegistryNameSets();

  const createEntries = changeSet.creates.map((item) => {
    const functionName = formatResolverFunctionName(item.request.namespaceName, item.name);
    const hasFunctionRegistryChange = Boolean(
      functionName && functionNames.creates.has(functionName),
    );
    if (functionName && hasFunctionRegistryChange) {
      consumed.creates.add(functionName);
    }
    return {
      action: "create" as const,
      symbol: actionSymbol("create"),
      name: item.name,
      labels: hasFunctionRegistryChange ? ["resolver", "functionRegistry"] : ["resolver"],
      detailLines: hasFunctionRegistryChange
        ? [...(item.detailLines ?? []), formatScriptAddedLine()]
        : item.detailLines,
    };
  });
  const deleteEntries = changeSet.deletes.map((item) => {
    const functionName = formatResolverFunctionName(item.request.namespaceName, item.name);
    const hasFunctionRegistryChange = Boolean(
      functionName && functionNames.deletes.has(functionName),
    );
    if (functionName && hasFunctionRegistryChange) {
      consumed.deletes.add(functionName);
    }
    return {
      action: "delete" as const,
      symbol: actionSymbol("delete"),
      name: item.name,
      labels: hasFunctionRegistryChange ? ["resolver", "functionRegistry"] : ["resolver"],
    };
  });
  const updateEntries = changeSet.updates.map((item) => {
    const functionName = formatResolverFunctionName(item.request.namespaceName, item.name);
    const hasFunctionRegistryChange = Boolean(
      functionName && functionNames.updates.has(functionName),
    );
    if (functionName && hasFunctionRegistryChange) {
      consumed.updates.add(functionName);
    }
    return {
      action: "update" as const,
      symbol: actionSymbol("update"),
      name: item.name,
      labels: hasFunctionRegistryChange ? ["resolver", "functionRegistry"] : ["resolver"],
      detailLines: hasFunctionRegistryChange
        ? [...(item.detailLines ?? []), formatScriptChangedLine()]
        : item.detailLines,
    };
  });
  const replaceEntries = (changeSet.replaces as ReadonlyArray<HasName>).map((item) => ({
    action: "replace" as const,
    symbol: actionSymbol("replace"),
    name: item.name,
    labels: ["resolver"],
  }));

  return [
    ...createEntries,
    ...deleteEntries,
    ...updateEntries,
    ...replaceEntries,
    ...buildRemainingFunctionRegistryEntries(functionNames, consumed).map((entry) => ({
      ...entry,
      detailLines:
        entry.action === "create"
          ? [formatScriptAddedLine()]
          : entry.action === "update"
            ? [formatScriptChangedLine()]
            : entry.detailLines,
    })),
  ];
}

function printResolverChanges(
  changeSet: ChangeSet<CreateResolver, UpdateResolver, DeleteResolver>,
  resolverFunctionChanges?: {
    creates: ReadonlyArray<HasName>;
    updates: ReadonlyArray<HasName>;
    deletes: ReadonlyArray<HasName>;
    replaces: ReadonlyArray<HasName>;
  },
  detail = false,
) {
  const entries = formatResolverChangeEntries(changeSet, resolverFunctionChanges);
  if (entries.length === 0) {
    return;
  }

  logger.log(styles.bold("Pipeline resolvers:"));
  for (const entry of entries) {
    logger.log(`  ${entry.symbol} ${entry.name} (${entry.labels.join(", ")})`);
    if (detail) {
      entry.detailLines?.forEach((line) => logger.log(`    ${line}`));
    }
  }
}

function normalizeComparableResolver(resolver: MessageInitShape<typeof PipelineResolverSchema>) {
  const normalized = normalizeProtoConfig(resolver) ?? {};
  return {
    name: normalized.name,
    description: normalized.description ?? "",
    authorization: normalized.authorization ?? "",
    operationType: normalized.operationType ?? "",
    publishExecutionEvents: normalized.publishExecutionEvents ?? false,
    inputs: normalizeComparableFields(normalized.inputs),
    response: normalizeComparableField(normalized.response),
    pipelines: normalizeComparablePipelines(normalized.pipelines),
  };
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

function formatResolverCreateDetailLines(
  resolver: MessageInitShape<typeof PipelineResolverSchema>,
  operation: Resolver["operation"] | number,
): string[] {
  const normalized = normalizeComparableResolver(resolver);
  const lines: string[] = [];

  if (normalized.description) {
    lines.push(
      formatActionDetailLine("create", `description: ${JSON.stringify(normalized.description)}`),
    );
  }

  lines.push(
    formatActionDetailLine("create", `operation: ${normalizeResolverOperation(operation)}`),
  );

  if (normalized.authorization && normalized.authorization !== "true==true") {
    lines.push(
      formatActionDetailLine(
        "create",
        `authorization: ${JSON.stringify(normalized.authorization)}`,
      ),
    );
  }

  if (normalized.inputs.length > 0) {
    lines.push(
      formatActionDetailLine(
        "create",
        `inputs: ${normalized.inputs
          .map((field) => field?.name)
          .filter(Boolean)
          .join(", ")}`,
      ),
    );
  }

  const outputFields = normalized.response?.type?.fields
    ?.map((field) => field?.name)
    .filter((name): name is string => Boolean(name));
  if (outputFields && outputFields.length > 0) {
    lines.push(formatActionDetailLine("create", `output: ${outputFields.join(", ")}`));
  }

  const pipelineNames = normalized.pipelines
    .map((pipeline) => pipeline.name)
    .filter((name) => name.length > 0);
  if (pipelineNames.length > 0) {
    lines.push(formatActionDetailLine("create", `pipelines: ${pipelineNames.join(", ")}`));
  }

  if (normalized.publishExecutionEvents) {
    lines.push(formatActionDetailLine("create", "publishEvents: true"));
  }

  return lines;
}

function normalizeResolverOperation(
  operation: Resolver["operation"] | number,
): "query" | "mutation" {
  if (operation === "query" || operation === 0) {
    return "query";
  }
  if (operation === "mutation" || operation === 1) {
    return "mutation";
  }
  throw new Error(`Unknown resolver operation: ${String(operation)}`);
}

function normalizeComparablePipelines(
  pipelines: MessageInitShape<typeof PipelineResolverSchema>["pipelines"],
): Array<{
  name: string;
  operationName: string;
  description: string;
  operationType: string;
  operationSourceRef: string;
  operationHook: string;
  postScript: string;
  skipOperationOnError: boolean;
  invoker:
    | NonNullable<MessageInitShape<typeof PipelineResolverSchema>["pipelines"]>[number]["invoker"]
    | undefined;
}> {
  return (pipelines ?? []).map((pipeline) => ({
    name: pipeline.name ?? "",
    operationName: pipeline.operationName ?? "",
    description: pipeline.description ?? "",
    operationType: String(pipeline.operationType ?? ""),
    operationSourceRef: pipeline.operationSourceRef ?? "",
    operationHook: pipeline.operationHook?.expr ?? "",
    postScript: pipeline.postScript ?? "",
    skipOperationOnError: pipeline.skipOperationOnError ?? false,
    invoker: pipeline.invoker ?? undefined,
  }));
}

function normalizeComparableFields(
  fields: MessageInitShape<typeof PipelineResolverSchema>["inputs"],
): Array<ReturnType<typeof normalizeComparableField>> {
  return (fields ?? []).map((field) => normalizeComparableField(field));
}

function normalizeComparableField(
  field: MessageInitShape<typeof PipelineResolver_FieldSchema> | undefined,
):
  | {
      name: string;
      array: boolean;
      required: boolean;
      description: string;
      type: ReturnType<typeof normalizeComparableType>;
    }
  | undefined {
  if (!field) {
    return undefined;
  }
  return {
    name: field.name ?? "",
    array: field.array ?? false,
    required: field.required ?? true,
    description: field.description ?? "",
    type: normalizeComparableType(field.type),
  };
}

function normalizeComparableType(
  type: MessageInitShape<typeof PipelineResolver_TypeSchema> | undefined,
):
  | {
      kind: string;
      name: string;
      required: boolean;
      description: string;
      allowedValues: unknown[];
      fields: Array<ReturnType<typeof normalizeComparableField>>;
    }
  | undefined {
  if (!type) {
    return undefined;
  }
  return {
    kind: type.kind ?? "",
    name: type.name ?? "",
    required: type.required ?? true,
    description: type.description ?? "",
    allowedValues: type.allowedValues ?? [],
    fields: (type.fields ?? []).map((field) => normalizeComparableField(field)),
  };
}

function processResolver(
  namespace: string,
  resolver: Resolver,
  executorUsedResolvers: ReadonlySet<string>,
  env: Record<string, string | number | boolean>,
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
      invoker: resolver.authInvoker,
    },
  ];

  const typeBaseName = inflection.camelize(resolver.name);

  // Build inputs
  const inputs: MessageInitShape<typeof PipelineResolver_FieldSchema>[] = resolver.input
    ? protoFields(resolver.input, `${typeBaseName}Input`, true)
    : [];

  // Build response
  const response: MessageInitShape<typeof PipelineResolver_FieldSchema> = protoFields(
    { "": resolver.output },
    `${typeBaseName}Output`,
    false,
  )[0];

  // Build description (combine resolver description and output description)
  const resolverDescription = resolver.description || `${resolver.name} resolver`;
  const outputDescription = resolver.output.metadata.description;
  const combinedDescription = outputDescription
    ? `${resolverDescription}\n\nReturns:\n${outputDescription}`
    : resolverDescription;

  // Determine publishExecutionEvents (user-facing name: publishEvents):
  // - If user explicitly sets a value (true or false), respect that (validation already ensures no executor conflict)
  // - If not set, use executor detection (true if executor uses this resolver)
  let publishExecutionEvents = false;
  if (resolver.publishEvents !== undefined) {
    publishExecutionEvents = resolver.publishEvents;
  } else if (executorUsedResolvers.has(resolver.name)) {
    publishExecutionEvents = true;
  }

  return {
    authorization: "true==true",
    description: combinedDescription,
    inputs,
    name: resolver.name,
    operationType: normalizeResolverOperation(resolver.operation),
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
  if (!fields) {
    return [];
  }

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
