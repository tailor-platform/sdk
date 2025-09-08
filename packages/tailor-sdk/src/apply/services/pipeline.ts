import * as fs from "node:fs";
import * as path from "node:path";

import { type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { getDistDir } from "@/config";
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
  type PipelineResolverSchema,
} from "@tailor-proto/tailor/v1/pipeline_resource_pb";
import {
  type Executor,
  type PipelineResolverService,
  type StepDef,
} from "@/services";
import { type Resolver } from "@/services/pipeline/resolver";
import { type Workspace } from "@/workspace";
import { ChangeSet } from ".";
import { type ApplyOptions } from "..";
import { fetchAll, type OperatorClient } from "../client";
import { OperationType } from "@/types/operator";
import * as inflection from "inflection";

export async function applyPipeline(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
  options: ApplyOptions,
) {
  const changeSet = await planPipeline(client, workspaceId, workspace);
  if (options.dryRun) {
    return;
  }

  // Services
  for (const create of changeSet.service.creates) {
    await client.createPipelineService(create.request);
  }
  for (const update of changeSet.service.updates) {
    await client.updatePipelineService(update.request);
  }
  for (const del of changeSet.service.deletes) {
    await client.deletePipelineService(del.request);
  }

  // Resolvers
  for (const create of changeSet.resolver.creates) {
    await client.createPipelineResolver(create.request);
  }
  for (const update of changeSet.resolver.updates) {
    await client.updatePipelineResolver(update.request);
  }
  for (const del of changeSet.resolver.deletes) {
    if (del.tag === "resolver-deleted") {
      await client.deletePipelineResolver(del.request);
    }
  }
}

async function planPipeline(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
) {
  const pipelines: Readonly<PipelineResolverService>[] = [];
  for (const app of workspace.applications) {
    for (const pipeline of app.pipelineResolverServices) {
      await pipeline.loadResolvers();
      pipelines.push(pipeline);
    }
  }
  const executors = Object.values(
    (await workspace.executorService?.loadExecutors()) ?? {},
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
    const triggerManifest = executor.trigger.manifest;
    if (
      triggerManifest &&
      "EventType" in triggerManifest &&
      triggerManifest.EventType === "pipeline.resolver.executed"
    ) {
      const condition = triggerManifest.Condition?.Expr;
      if (condition && typeof condition === "string") {
        const match = condition.match(/args\.resolverName === "([^"]+)"/);
        if (match) {
          executorUsedResolvers.add(match[1]);
        }
      }
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

// TODO(remiposo): Copied the type-processor / aggregator processing almost as-is.
// This will need refactoring later.

export interface ResolverManifestMetadata {
  name: string;
  inputType: string;
  outputType: string;
  queryType: "query" | "mutation";
  pipelines: PipelineInfo[];
  outputMapper?: string; // 関数の文字列表現
  inputFields?: Record<
    string,
    { type: string; required: boolean; array: boolean }
  >;
  outputFields?: Record<
    string,
    { type: string; required: boolean; array: boolean }
  >;
  resolverManifest?: any; // 生成されたResolverManifest
}

export interface PipelineInfo {
  name: string;
  description: string;
  operationType: OperationType;
  operationSource?: string;
}

function processResolver(
  resolver: Resolver,
  executorUsedResolvers: ReadonlySet<string>,
): MessageInitShape<typeof PipelineResolverSchema> {
  const pipelines: PipelineInfo[] = resolver.steps.map(
    (step: StepDef<string, any, any, any>) => {
      const [type, name] = step;
      switch (type) {
        case "fn":
        case "sql": {
          const functionPath = path.join(
            getDistDir(),
            "functions",
            `${resolver.name}__${name}.js`,
          );
          let functionCode = "";
          try {
            functionCode = fs.readFileSync(functionPath, "utf-8");
          } catch {
            console.warn(`Function file not found: ${functionPath}`);
          }
          return {
            name,
            description: name,
            operationType: OperationType.FUNCTION,
            operationSource: functionCode,
          };
        }
        case "gql":
          return {
            name,
            description: name,
            operationType: OperationType.GRAPHQL,
            operationSource: "",
          };
        default:
          throw new Error(`Unsupported step kind: ${step[0]}`);
      }
    },
  );

  // Input型のフィールド情報を抽出
  const inputFields = extractTypeFields(resolver.input);

  // Output型のフィールド情報を抽出
  const outputFields = resolver.output
    ? extractTypeFields(resolver.output)
    : undefined;

  const typeBaseName = inflection.camelize(resolver.name);
  const metadata: ResolverManifestMetadata = {
    name: resolver.name,
    inputType: `${typeBaseName}Input`,
    outputType: `${typeBaseName}Output`,
    queryType: resolver.queryType,
    pipelines,
    outputMapper: resolver.outputMapper?.toString(),
    inputFields,
    outputFields,
  };

  return generateResolverManifest(
    resolver.name,
    metadata,
    executorUsedResolvers,
  );
}

function generateResolverManifest(
  name: string,
  resolverMetadata: ResolverManifestMetadata,
  executorUsedResolvers: ReadonlySet<string>,
): MessageInitShape<typeof PipelineResolverSchema> {
  const pipelines: MessageInitShape<typeof PipelineResolver_PipelineSchema>[] =
    [
      ...resolverMetadata.pipelines.map((pipeline) => {
        let operationType;
        switch (pipeline.operationType) {
          case OperationType.FUNCTION:
            operationType = PipelineResolver_OperationType.FUNCTION;
            break;
          case OperationType.GRAPHQL:
            operationType = PipelineResolver_OperationType.GRAPHQL;
            break;
          default:
            throw new Error(
              `Unknown operation type: ${pipeline.operationType}`,
            );
        }

        return {
          name: pipeline.name,
          operationName: pipeline.name,
          description: pipeline.description,
          operationType,
          operationSource: pipeline.operationSource,
          operationHook: {
            expr: "({ ...context.pipeline, ...context.args });",
          },
          postScript: `args.${pipeline.name}`,
        };
      }),
      {
        name: `__construct_output`,
        operationName: `__construct_output`,
        description: "Construct output from resolver",
        operationType: PipelineResolver_OperationType.FUNCTION,
        operationSource: `globalThis.main = ${resolverMetadata.outputMapper || "() => ({})"}`,
        operationHook: {
          expr: "({ ...context.pipeline, ...context.args });",
        },
        postScript: `args.__construct_output`,
      },
    ];

  // Input構造を生成（Fields配列を含む）
  const inputs: MessageInitShape<typeof PipelineResolver_FieldSchema>[] = [
    {
      name: "input",
      description: "",
      array: false,
      required: true,
      type: {
        kind: "UserDefined",
        name: resolverMetadata.inputType,
        description: "",
        required: false,
        fields: generateTypeFields(
          resolverMetadata.inputType,
          resolverMetadata.inputFields,
        ),
      },
    },
  ];

  // Response構造を生成（Fields配列を含む）
  const response: MessageInitShape<typeof PipelineResolver_FieldSchema> = {
    type: {
      kind: "UserDefined",
      name: resolverMetadata.outputType,
      description: "",
      required: true,
      fields: generateTypeFields(
        resolverMetadata.outputType,
        resolverMetadata.outputFields,
      ),
    },
    description: "",
    array: false,
    required: true,
  };

  return {
    authorization: "true==true", // デフォルト値
    description: `${name} resolver`,
    inputs: inputs,
    name: name,
    operationType: resolverMetadata.queryType,
    response: response,
    pipelines: pipelines,
    postHook: { expr: "({ ...context.pipeline.__construct_output });" },
    publishExecutionEvents: executorUsedResolvers.has(name) ? true : false,
  };
}

function getTypeDefinition(fieldType: string): {
  kind: "ScalarType" | "CustomScalarType";
  name: string;
} {
  const tailorToGraphQL: Record<string, string> = {
    string: "String",
    number: "Int",
    integer: "Int",
    boolean: "Boolean",
    float: "Float",
    date: "String",
    datetime: "String",
    time: "String",
    json: "String",
  };

  const customScalarTypes = ["date", "datetime", "time"];
  const isCustomScalar = customScalarTypes.includes(fieldType);

  return {
    kind: isCustomScalar ? "CustomScalarType" : "ScalarType",
    name: isCustomScalar
      ? fieldType === "datetime"
        ? "DateTime"
        : fieldType === "date"
          ? "Date"
          : fieldType === "time"
            ? "Time"
            : fieldType
      : tailorToGraphQL[fieldType] || "String",
  };
}

function createFieldDefinition(
  fieldName: string,
  fieldType: string,
  required: boolean,
  array: boolean,
  description: string = "",
): MessageInitShape<typeof PipelineResolver_FieldSchema> {
  const typeDefinition = getTypeDefinition(fieldType);

  return {
    name: fieldName,
    description: description,
    type: {
      kind: typeDefinition.kind,
      name: typeDefinition.name,
      description: "",
      required: false, // Note: This is always false in the CUE schema for scalar types
    },
    array: array,
    required: required,
  };
}

function generateTypeFields(
  typeName: string,
  fields?: Record<
    string,
    { type: string; required: boolean; array: boolean; fields?: any }
  >,
  allFields?: Record<string, any>,
): MessageInitShape<typeof PipelineResolver_FieldSchema>[] {
  if (fields && Object.keys(fields).length > 0) {
    return Object.entries(fields).map(([fieldName, fieldInfo]) => {
      if (fieldInfo.type === "nested") {
        const capitalizedTypeName = typeName + inflection.camelize(fieldName);

        let nestedFields: MessageInitShape<
          typeof PipelineResolver_FieldSchema
        >[] = [];
        if (fieldInfo.fields && typeof fieldInfo.fields === "object") {
          nestedFields = generateNestedFields(
            fieldInfo.fields,
            capitalizedTypeName,
          );
        } else if (allFields && allFields[capitalizedTypeName]) {
          nestedFields = generateTypeFields(
            capitalizedTypeName,
            allFields[capitalizedTypeName],
            allFields,
          );
        } else {
          console.warn(
            `No nested field information found for ${fieldName} in type ${typeName}. Using empty fields.`,
          );
        }

        return {
          name: fieldName,
          description: "",
          type: {
            kind: "UserDefined",
            name: capitalizedTypeName,
            description: "",
            required: fieldInfo.required,
            fields: nestedFields,
          },
          array: fieldInfo.array,
          required: fieldInfo.required,
        };
      }

      return createFieldDefinition(
        fieldName,
        fieldInfo.type,
        fieldInfo.required,
        fieldInfo.array,
      );
    });
  }

  console.warn(
    `No field information available for type: ${typeName}. Returning empty fields array.`,
  );
  return [];
}

function generateNestedFields(
  nestedFields: any,
  parentTypeName?: string,
): MessageInitShape<typeof PipelineResolver_FieldSchema>[] {
  if (!nestedFields || typeof nestedFields !== "object") {
    return [];
  }

  return Object.entries(nestedFields).map(
    ([fieldName, field]: [string, any]) => {
      const fieldObj = field;

      const metadata = fieldObj?.metadata || {};
      const fieldType = metadata.type || "string";
      const required = metadata.required !== false;
      const array = metadata.array === true;

      if (fieldType === "nested" && fieldObj.fields) {
        const nestedTypeName = `${parentTypeName ?? ""}${inflection.camelize(fieldName)}`;

        return {
          name: fieldName,
          description: metadata.description || "",
          type: {
            kind: "UserDefined",
            name: nestedTypeName,
            description: "",
            required: required,
            fields: generateNestedFields(fieldObj.fields, nestedTypeName),
          },
          array: array,
          required: required,
        };
      }

      return createFieldDefinition(
        fieldName,
        fieldType,
        required,
        array,
        metadata.description || "",
      );
    },
  );
}

function extractTypeFields(
  type: any,
):
  | Record<
      string,
      { type: string; required: boolean; array: boolean; fields?: any }
    >
  | undefined {
  if (!type || !type.fields) {
    return undefined;
  }

  const fields: Record<
    string,
    { type: string; required: boolean; array: boolean; fields?: any }
  > = {};

  for (const [fieldName, field] of Object.entries(type.fields)) {
    const fieldObj = field as any;
    if (fieldObj && fieldObj.metadata) {
      const metadata = fieldObj.metadata;
      fields[fieldName] = {
        type: metadata.type || "string",
        required: metadata.required !== false,
        array: metadata.array === true,
      };

      // nested objectの場合、fieldsプロパティも含める
      if (metadata.type === "nested" && fieldObj.fields) {
        fields[fieldName].fields = fieldObj.fields;
      }
    }
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}
