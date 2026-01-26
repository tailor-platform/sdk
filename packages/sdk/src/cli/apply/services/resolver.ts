import * as fs from "node:fs";
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
import * as path from "pathe";
import { type ResolverService } from "@/cli/application/resolver/service";
import { logger } from "@/cli/utils/logger";
import { getDistDir } from "@/configure/config";
import { type Resolver, type TailorField } from "@/parser/service/resolver";
import { tailorUserMap } from "@/parser/service/tailordb";
import { fetchAll, type OperatorClient } from "../../client";
import { buildMetaRequest, sdkNameLabelKey, type WithLabel } from "./label";
import { createChangeSet } from ".";
import type { ApplyPhase, PlanContext } from "..";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { Executor } from "@/parser/service/executor";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

// Scalar type mapping for field type conversion
const SCALAR_TYPE_MAP = {
  uuid: { kind: "ScalarType", name: "ID" },
  string: { kind: "ScalarType", name: "String" },
  integer: { kind: "ScalarType", name: "Int" },
  float: { kind: "ScalarType", name: "Float" },
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
 * @returns Planned changes
 */
export async function planPipeline(context: PlanContext) {
  const { client, workspaceId, application, forRemoval } = context;
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
  );

  serviceChangeSet.print();
  resolverChangeSet.print();
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

  const withoutLabel = await fetchAll(async (pageToken) => {
    try {
      const { pipelineServices, nextPageToken } = await client.listPipelineServices({
        workspaceId,
        pageToken,
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

      changeSet.updates.push({
        name: pipeline.namespace,
        request: {
          workspaceId,
          namespaceName: pipeline.namespace,
        },
        metaRequest,
      });
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
  request: MessageInitShape<typeof CreatePipelineResolverRequestSchema>;
};

type UpdateResolver = {
  name: string;
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
) {
  const changeSet = createChangeSet<CreateResolver, UpdateResolver, DeleteResolver>(
    "Pipeline resolvers",
  );

  const fetchResolvers = (namespaceName: string) => {
    return fetchAll(async (pageToken) => {
      try {
        const { pipelineResolvers, nextPageToken } = await client.listPipelineResolvers({
          workspaceId,
          namespaceName,
          pageToken,
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

  for (const pipeline of pipelines) {
    const existingResolvers = await fetchResolvers(pipeline.namespace);
    const existingNameSet = new Set<string>();
    existingResolvers.forEach((resolver) => {
      existingNameSet.add(resolver.name);
    });
    for (const resolver of Object.values(pipeline.getResolvers())) {
      if (existingNameSet.has(resolver.name)) {
        changeSet.updates.push({
          name: resolver.name,
          request: {
            workspaceId,
            namespaceName: pipeline.namespace,
            pipelineResolver: processResolver(resolver, executorUsedResolvers, env),
          },
        });
        existingNameSet.delete(resolver.name);
      } else {
        changeSet.creates.push({
          name: resolver.name,
          request: {
            workspaceId,
            namespaceName: pipeline.namespace,
            pipelineResolver: processResolver(resolver, executorUsedResolvers, env),
          },
        });
      }
    }
    existingNameSet.forEach((name) => {
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

function processResolver(
  resolver: Resolver,
  executorUsedResolvers: ReadonlySet<string>,
  env: Record<string, string | number | boolean>,
): MessageInitShape<typeof PipelineResolverSchema> {
  // Read body function code
  const functionPath = path.join(getDistDir(), "resolvers", `${resolver.name}.js`);
  let functionCode = "";
  try {
    functionCode = fs.readFileSync(functionPath, "utf-8");
  } catch {
    logger.warn(`Function file not found: ${functionPath}`);
  }

  const pipelines: MessageInitShape<typeof PipelineResolver_PipelineSchema>[] = [
    {
      name: "body",
      operationName: "body",
      description: `${resolver.name} function body`,
      operationType: PipelineResolver_OperationType.FUNCTION,
      operationSource: functionCode,
      operationHook: {
        expr: `({ ...context.pipeline, input: context.args, user: ${tailorUserMap}, env: ${JSON.stringify(env)} });`,
      },
      postScript: `args.body`,
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

  return {
    authorization: "true==true",
    description: combinedDescription,
    inputs,
    name: resolver.name,
    operationType: resolver.operation,
    response,
    pipelines,
    publishExecutionEvents: executorUsedResolvers.has(resolver.name),
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
