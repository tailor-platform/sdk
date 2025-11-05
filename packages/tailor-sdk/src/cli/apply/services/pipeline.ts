import * as fs from "node:fs";
import * as path from "node:path";
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
import { type Application } from "@/cli/application";
import { type PipelineResolverService } from "@/cli/application/pipeline/service";
import { getDistDir } from "@/configure/config";
import { type Executor } from "@/configure/services/executor/types";
import { tailorUserMap } from "@/configure/types";
import { type Resolver, type TailorField } from "@/parser/service/pipeline";
import { type ApplyPhase } from "..";
import { fetchAll, type OperatorClient } from "../../client";
import { ChangeSet } from ".";

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

export async function applyPipeline(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planPipeline>>,
  phase: ApplyPhase = "create-update",
) {
  if (phase === "create-update") {
    // Services
    for (const create of changeSet.service.creates) {
      await client.createPipelineService(create.request);
    }
    for (const update of changeSet.service.updates) {
      await client.updatePipelineService(update.request);
    }

    // Resolvers
    for (const create of changeSet.resolver.creates) {
      await client.createPipelineResolver(create.request);
    }
    for (const update of changeSet.resolver.updates) {
      await client.updatePipelineResolver(update.request);
    }
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // Resolvers
    for (const del of changeSet.resolver.deletes) {
      if (del.tag === "resolver-deleted") {
        await client.deletePipelineResolver(del.request);
      }
    }

    // Services
    for (const del of changeSet.service.deletes) {
      await client.deletePipelineService(del.request);
    }
  }
}
export async function planPipeline(
  client: OperatorClient,
  workspaceId: string,
  application: Readonly<Application>,
) {
  const pipelines: Readonly<PipelineResolverService>[] = [];
  for (const app of application.applications) {
    for (const pipeline of app.pipelineResolverServices) {
      await pipeline.loadResolvers();
      pipelines.push(pipeline);
    }
  }
  const executors = Object.values(
    (await application.executorService?.loadExecutors()) ?? {},
  );

  const serviceChangeSet = await planServices(client, workspaceId, pipelines);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const resolverChangeSet = await planResolvers(
    client,
    workspaceId,
    pipelines,
    executors,
    deletedServices,
  );

  serviceChangeSet.print();
  resolverChangeSet.print();
  return {
    service: serviceChangeSet,
    resolver: resolverChangeSet,
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreatePipelineServiceRequestSchema>;
};

type UpdateService = {
  name: string;
  request: MessageInitShape<typeof UpdatePipelineServiceRequestSchema>;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeletePipelineServiceRequestSchema>;
};

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  pipelines: ReadonlyArray<Readonly<PipelineResolverService>>,
) {
  const changeSet: ChangeSet<CreateService, UpdateService, DeleteService> =
    new ChangeSet("Pipeline services");

  const existingServices = await fetchAll(async (pageToken) => {
    try {
      const { pipelineServices, nextPageToken } =
        await client.listPipelineServices({
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
  const existingNameSet = new Set<string>();
  existingServices.forEach((service) => {
    const name = service.namespace?.name;
    if (name) {
      existingNameSet.add(name);
    }
  });
  for (const pipeline of pipelines) {
    if (existingNameSet.has(pipeline.namespace)) {
      changeSet.updates.push({
        name: pipeline.namespace,
        request: {
          workspaceId,
          namespaceName: pipeline.namespace,
        },
      });
      existingNameSet.delete(pipeline.namespace);
    } else {
      changeSet.creates.push({
        name: pipeline.namespace,
        request: {
          workspaceId,
          namespaceName: pipeline.namespace,
        },
      });
    }
  }
  existingNameSet.forEach((namespaceName) => {
    changeSet.deletes.push({
      name: namespaceName,
      request: {
        workspaceId,
        namespaceName,
      },
    });
  });
  return changeSet;
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
  tag: "resolver-deleted";
  name: string;
  request: MessageInitShape<typeof DeletePipelineResolverRequestSchema>;
};

type ServiceDeleted = {
  tag: "service-deleted";
  name: string;
};

async function planResolvers(
  client: OperatorClient,
  workspaceId: string,
  pipelines: ReadonlyArray<Readonly<PipelineResolverService>>,
  executors: ReadonlyArray<Executor>,
  deletedServices: ReadonlyArray<string>,
) {
  const changeSet: ChangeSet<
    CreateResolver,
    UpdateResolver,
    DeleteResolver | ServiceDeleted
  > = new ChangeSet("Pipeline resolvers");

  const fetchResolvers = (namespaceName: string) => {
    return fetchAll(async (pageToken) => {
      try {
        const { pipelineResolvers, nextPageToken } =
          await client.listPipelineResolvers({
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
    if (
      executor.trigger.Kind === "Event" &&
      executor.trigger.EventType.kind === "pipeline.resolver.executed"
    ) {
      executorUsedResolvers.add(executor.trigger.EventType.resolverName);
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
            pipelineResolver: processResolver(resolver, executorUsedResolvers),
          },
        });
        existingNameSet.delete(resolver.name);
      } else {
        changeSet.creates.push({
          name: resolver.name,
          request: {
            workspaceId,
            namespaceName: pipeline.namespace,
            pipelineResolver: processResolver(resolver, executorUsedResolvers),
          },
        });
      }
    }
    existingNameSet.forEach((name) => {
      changeSet.deletes.push({
        tag: "resolver-deleted",
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
        tag: "service-deleted",
        name: resolver.name,
      });
    });
  }
  return changeSet;
}

function processResolver(
  resolver: Resolver,
  executorUsedResolvers: ReadonlySet<string>,
): MessageInitShape<typeof PipelineResolverSchema> {
  // Read body function code
  const functionPath = path.join(
    getDistDir(),
    "functions",
    `${resolver.name}__body.js`,
  );
  let functionCode = "";
  try {
    functionCode = fs.readFileSync(functionPath, "utf-8");
  } catch {
    console.warn(`Function file not found: ${functionPath}`);
  }

  const pipelines: MessageInitShape<typeof PipelineResolver_PipelineSchema>[] =
    [
      {
        name: "body",
        operationName: "body",
        description: `${resolver.name} function body`,
        operationType: PipelineResolver_OperationType.FUNCTION,
        operationSource: functionCode,
        operationHook: {
          expr: `({ ...context.pipeline, input: context.args, user: ${tailorUserMap} });`,
        },
        postScript: `args.body`,
      },
    ];

  const typeBaseName = inflection.camelize(resolver.name);

  // Build inputs
  const inputs: MessageInitShape<typeof PipelineResolver_FieldSchema>[] =
    resolver.input
      ? protoFields(resolver.input, `${typeBaseName}Input`, true)
      : [];

  // Build response
  const response: MessageInitShape<typeof PipelineResolver_FieldSchema> =
    protoFields({ "": resolver.output }, `${typeBaseName}Output`, false)[0];

  // Build description (combine resolver description and output description)
  const resolverDescription =
    resolver.description || `${resolver.name} resolver`;
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
    postHook: { expr: "({ ...context.pipeline.body });" },
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
      const typeName =
        field.metadata.typeName ??
        `${baseName}${inflection.camelize(fieldName)}`;
      type = {
        kind: "UserDefined",
        name: typeName,
        description: field.metadata.description ?? "",
        required,
        fields: protoFields(field.fields, typeName, isInput),
      };
    } else if (field.type === "enum") {
      const typeName =
        field.metadata.typeName ??
        `${baseName}${inflection.camelize(fieldName)}`;
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
