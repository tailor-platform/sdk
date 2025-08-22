import { fromJson, MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";

import {
  CreateTailorDBGQLPermissionRequestSchema,
  CreateTailorDBServiceRequestSchema,
  CreateTailorDBTypeRequestSchema,
  DeleteTailorDBGQLPermissionRequestSchema,
  DeleteTailorDBServiceRequestSchema,
  DeleteTailorDBTypeRequestSchema,
  UpdateTailorDBGQLPermissionRequestSchema,
  UpdateTailorDBTypeRequestSchema,
} from "@/gen/tailor/v1/tailordb_pb";
import {
  TailorDBGQLPermission_Action,
  TailorDBGQLPermission_ConditionSchema,
  TailorDBGQLPermission_OperandSchema,
  TailorDBGQLPermission_Operator,
  TailorDBGQLPermission_Permit,
  TailorDBGQLPermission_PolicySchema,
  TailorDBGQLPermissionSchema,
  TailorDBType_FieldConfigSchema,
  TailorDBType_IndexSchema,
  TailorDBType_Permission_ConditionSchema,
  TailorDBType_Permission_OperandSchema,
  TailorDBType_Permission_Operator,
  TailorDBType_Permission_Permit,
  TailorDBType_Permission_PolicySchema,
  TailorDBType_PermissionSchema,
  TailorDBType_PermitAction,
  TailorDBType_RelationshipConfigSchema,
  TailorDBTypeSchema,
} from "@/gen/tailor/v1/tailordb_resource_pb";
import { ApplyOptions } from "@/generator/options";
import { Executor } from "@/services";
import {
  PermissionOperand,
  StandardActionPermission,
  StandardGqlPermissionPolicy,
  StandardPermissionCondition,
  StandardTailorTypeGqlPermission,
  StandardTailorTypePermission,
} from "@/services/tailordb/permission";
import { TailorDBType } from "@/services/tailordb/schema";
import { TailorDBService } from "@/services/tailordb/service";
import { DBFieldMetadata } from "@/services/tailordb/types";
import { tailorToManifestScalar } from "@/types/types";
import { Workspace } from "@/workspace";
import { ChangeSet, HasName } from ".";
import { fetchAll, OperatorClient } from "../client";

export async function applyTailorDB(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
  options: ApplyOptions,
) {
  const changeSet = await planTailorDB(client, workspaceId, workspace);
  if (options.dryRun) {
    return;
  }

  // Create / Update
  // Services
  for (const create of changeSet.service.creates) {
    await client.createTailorDBService(create.request);
  }
  // Types
  for (const create of changeSet.type.creates) {
    await client.createTailorDBType(create.request);
  }
  for (const update of changeSet.type.updates) {
    await client.updateTailorDBType(update.request);
  }
  // GQLPermissions
  for (const create of changeSet.gqlPermission.creates) {
    await client.createTailorDBGQLPermission(create.request);
  }
  for (const update of changeSet.gqlPermission.updates) {
    await client.updateTailorDBGQLPermission(update.request);
  }

  // Delete (Execute in reverse order considering dependencies)
  // GQLPermissions
  for (const del of changeSet.gqlPermission.deletes) {
    if (del.tag === "gql-permission-deleted") {
      await client.deleteTailorDBGQLPermission(del.request);
    }
  }
  // Types
  for (const del of changeSet.type.deletes) {
    if (del.tag === "type-deleted") {
      await client.deleteTailorDBType(del.request);
    }
  }
  // Services
  for (const del of changeSet.service.deletes) {
    await client.deleteTailorDBService(del.request);
  }
}

async function planTailorDB(
  client: OperatorClient,
  workspaceId: string,
  workspace: Readonly<Workspace>,
) {
  const tailordbs: TailorDBService[] = [];
  for (const app of workspace.applications) {
    for (const tailordb of app.tailorDBServices) {
      await tailordb.loadTypes();
      tailordbs.push(tailordb);
    }
  }
  const executors = Object.values(
    (await workspace.executorService?.loadExecutors()) ?? {},
  );

  const serviceChangeSet = await planServices(client, workspaceId, tailordbs);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const typeChangeSet = await planTypes(
    client,
    workspaceId,
    tailordbs,
    executors,
    deletedServices,
  );
  const gqlPermissionChangeSet = await planGqlPermissions(
    client,
    workspaceId,
    tailordbs,
    deletedServices,
  );

  serviceChangeSet.print();
  typeChangeSet.print();
  gqlPermissionChangeSet.print();
  return {
    service: serviceChangeSet,
    type: typeChangeSet,
    gqlPermission: gqlPermissionChangeSet,
  };
}

type CreateService = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBServiceRequestSchema>;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBServiceRequestSchema>;
};

type ServiceDeleted = {
  tag: "service-deleted";
  name: string;
};

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBService>,
) {
  const changeSet: ChangeSet<CreateService, HasName, DeleteService> =
    new ChangeSet("TailorDB services");

  const existingServices = await fetchAll(async (pageToken) => {
    try {
      const { tailordbServices, nextPageToken } =
        await client.listTailorDBServices({
          workspaceId,
          pageToken,
        });
      return [tailordbServices, nextPageToken];
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
  for (const tailordb of tailordbs) {
    if (existingNameSet.has(tailordb.namespace)) {
      changeSet.updates.push({
        name: tailordb.namespace,
      });
      existingNameSet.delete(tailordb.namespace);
    } else {
      changeSet.creates.push({
        name: tailordb.namespace,
        request: {
          workspaceId,
          namespaceName: tailordb.namespace,
          // Set UTC to match tailorctl/terraform
          defaultTimezone: "UTC",
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

type CreateType = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBTypeRequestSchema>;
};

type UpdateType = {
  name: string;
  request: MessageInitShape<typeof UpdateTailorDBTypeRequestSchema>;
};

type DeleteType = {
  tag: "type-deleted";
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBTypeRequestSchema>;
};

async function planTypes(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBService>,
  executors: ReadonlyArray<Executor>,
  deletedServices: ReadonlyArray<string>,
) {
  const changeSet: ChangeSet<
    CreateType,
    UpdateType,
    DeleteType | ServiceDeleted
  > = new ChangeSet("TailorDB types");

  const fetchTypes = (namespaceName: string) => {
    return fetchAll(async (pageToken) => {
      try {
        const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes(
          {
            workspaceId,
            namespaceName,
            pageToken,
          },
        );
        return [tailordbTypes, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });
  };

  const executorUsedTypes = new Set<string>();
  for (const executor of executors) {
    const triggerContext = executor.trigger.context;
    if ("type" in triggerContext && triggerContext.type) {
      executorUsedTypes.add(triggerContext.type);
    }
  }

  for (const tailordb of tailordbs) {
    const existingTypes = await fetchTypes(tailordb.namespace);
    const existingNameSet = new Set<string>();
    existingTypes.forEach((typ) => {
      existingNameSet.add(typ.name);
    });
    for (const fileTypes of Object.values(tailordb.getTypes())) {
      for (const typ of Object.values(fileTypes)) {
        const tailordbType = generateTailorDBTypeManifest(
          typ,
          executorUsedTypes,
        );
        if (existingNameSet.has(typ.name)) {
          changeSet.updates.push({
            name: typ.name,
            request: {
              workspaceId,
              namespaceName: tailordb.namespace,
              tailordbType,
            },
          });
          existingNameSet.delete(typ.name);
        } else {
          changeSet.creates.push({
            name: typ.name,
            request: {
              workspaceId,
              namespaceName: tailordb.namespace,
              tailordbType,
            },
          });
        }
      }
    }
    existingNameSet.forEach((name) => {
      changeSet.deletes.push({
        tag: "type-deleted",
        name,
        request: {
          workspaceId,
          namespaceName: tailordb.namespace,
          tailordbTypeName: name,
        },
      });
    });
  }
  for (const namespaceName of deletedServices) {
    const existingTypes = await fetchTypes(namespaceName);
    existingTypes.forEach((typ) => {
      changeSet.deletes.push({
        tag: "service-deleted",
        name: typ.name,
      });
    });
  }
  return changeSet;
}

// TODO(remiposo): Copied the type-processor / aggregator processing almost as-is.
// This will need refactoring later.
function generateTailorDBTypeManifest(
  type: TailorDBType,
  executorUsedTypes: ReadonlySet<string>,
): MessageInitShape<typeof TailorDBTypeSchema> {
  const metadata = type.metadata;
  const schema = metadata.schema;

  const defaultSettings = {
    aggregation: schema?.settings?.aggregation || false,
    bulkUpsert: schema?.settings?.bulkUpsert || false,
    draft: false,
    defaultQueryLimitSize: 100n,
    maxBulkUpsertSize: 1000n,
    pluralForm: schema?.settings?.pluralForm
      ? schema.settings.pluralForm.charAt(0).toLowerCase() +
        schema.settings.pluralForm.slice(1)
      : "",
    publishRecordEvents: false,
  };
  if (executorUsedTypes.has(type.name)) {
    defaultSettings.publishRecordEvents = true;
  }

  const fields: Record<
    string,
    MessageInitShape<typeof TailorDBType_FieldConfigSchema>
  > = {};
  if (schema?.fields) {
    Object.entries(schema.fields)
      .filter(([fieldName]) => fieldName !== "id")
      .forEach(([fieldName, fieldConfig]) => {
        const fieldType = fieldConfig.type || "string";
        const fieldEntry: MessageInitShape<
          typeof TailorDBType_FieldConfigSchema
        > = {
          type: fieldType,
          allowedValues:
            fieldType === "enum" ? fieldConfig.allowedValues || [] : [],
          description: fieldConfig.description || "",
          validate: (fieldConfig.validate || []).map((val) => ({
            action: TailorDBType_PermitAction.DENY,
            errorMessage: val.errorMessage || "",
            ...(val.script && {
              script: {
                expr: val.script.expr ? `!${val.script.expr}` : "",
              },
            }),
          })),
          array: fieldConfig.array || false,
          index: (fieldConfig.index && !fieldConfig.array) || false,
          unique: (fieldConfig.unique && !fieldConfig.array) || false,
          foreignKey: fieldConfig.foreignKey || false,
          foreignKeyType: fieldConfig.foreignKeyType,
          required: fieldConfig.required !== false,
          vector: fieldConfig.vector || false,
          ...(fieldConfig.hooks && {
            hooks: {
              create: fieldConfig.hooks?.create
                ? {
                    expr: fieldConfig.hooks.create.expr || "",
                  }
                : undefined,
              update: fieldConfig.hooks?.update
                ? {
                    expr: fieldConfig.hooks.update.expr || "",
                  }
                : undefined,
            },
          }),
          ...(fieldConfig.serial && {
            serial: {
              start: fieldConfig.serial.start as unknown as bigint,
              ...(fieldConfig.serial.maxValue && {
                maxValue: fieldConfig.serial.maxValue as unknown as bigint,
              }),
              ...(fieldConfig.serial.format && {
                format: fieldConfig.serial.format,
              }),
            },
          }),
        };

        if (fieldConfig.type === "nested") {
          fieldEntry.type = "nested";
          delete fieldEntry.vector;

          const objectField = type.fields[fieldName];
          if (objectField && objectField.fields) {
            fieldEntry.fields = processNestedFields(objectField.fields);
          }
        }

        fields[fieldName] = fieldEntry;
      });
  }

  const relationships: Record<
    string,
    MessageInitShape<typeof TailorDBType_RelationshipConfigSchema>
  > = {};
  Object.entries(type.fields)
    .filter(([_, fieldConfig]: [string, any]) => fieldConfig.reference)
    .forEach(([fieldName, fieldConfig]: [string, any]) => {
      if (fieldConfig.reference) {
        const ref = fieldConfig.reference;
        const nameMap = ref.nameMap || [];
        if (nameMap.length > 0) {
          relationships[nameMap[0]] = {
            refType: ref.type.name,
            refField: ref.key || "id",
            srcField: fieldName,
            array: fieldConfig._metadata?.array || false,
            description: ref.type.metadata.description || "",
          };
        }
      }
    });

  if (type.referenced && Object.keys(type.referenced).length > 0) {
    Object.entries(type.referenced).forEach(
      ([backwardFieldName, [referencedType, fieldName]]) => {
        const field = referencedType.fields[fieldName];
        const nameMap = field.reference?.nameMap;
        const array = !(field.metadata?.unique ?? false);
        const key = nameMap[1] || backwardFieldName;
        const srcField = field.reference?.key;
        relationships[key] = {
          refType: referencedType.name,
          refField: fieldName,
          srcField: srcField || "id",
          array: array,
          description: referencedType.metadata.schema?.description || "",
        };
      },
    );
  }

  // Process indexes from metadata
  const indexes: Record<
    string,
    MessageInitShape<typeof TailorDBType_IndexSchema>
  > = {};
  if (schema?.indexes) {
    Object.entries(schema.indexes).forEach(([key, index]) => {
      indexes[key] = {
        fieldNames: index.fields,
        unique: index.unique || false,
      };
    });
  }

  // To be secure by default, add Permission settings that reject everyone
  // when Permission/RecordPermission is not configured.
  const defaultPermission: MessageInitShape<
    typeof TailorDBType_PermissionSchema
  > = {
    create: [],
    read: [],
    update: [],
    delete: [],
  };
  const permission = schema.permissions.record
    ? protoPermission(schema.permissions.record)
    : defaultPermission;

  return {
    name: metadata.name || type.name,
    schema: {
      description: schema?.description || "",
      fields: fields,
      relationships: relationships,
      settings: defaultSettings,
      extends: schema?.extends || false,
      directives: [],
      indexes: indexes,
      permission,
    },
  };
}

function processNestedFields(
  objectFields: any,
): Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>> {
  const nestedFields: Record<
    string,
    MessageInitShape<typeof TailorDBType_FieldConfigSchema>
  > = {};

  Object.entries(objectFields).forEach(
    ([nestedFieldName, nestedFieldDef]: [string, any]) => {
      const nestedMetadata = nestedFieldDef.metadata as DBFieldMetadata;

      if (nestedMetadata.type === "nested" && nestedFieldDef.fields) {
        const deepNestedFields = processNestedFields(nestedFieldDef.fields);
        nestedFields[nestedFieldName] = {
          type: "nested",
          allowedValues: nestedMetadata.allowedValues || [],
          description: nestedMetadata.description || "",
          validate: [],
          required: nestedMetadata.required ?? true,
          array: nestedMetadata.array ?? false,
          index: false,
          unique: false,
          foreignKey: false,
          vector: false,
          fields: deepNestedFields,
        };
      } else {
        nestedFields[nestedFieldName] = {
          type:
            tailorToManifestScalar[
              nestedMetadata.type as keyof typeof tailorToManifestScalar
            ] || nestedMetadata.type,
          allowedValues: nestedMetadata.allowedValues || [],
          description: nestedMetadata.description || "",
          validate: [],
          required: nestedMetadata.required ?? true,
          array: nestedMetadata.array ?? false,
          index: false,
          unique: false,
          foreignKey: false,
          vector: false,
          ...(nestedMetadata.serial && {
            serial: {
              start: nestedMetadata.serial.start as unknown as bigint,
              ...(nestedMetadata.serial.maxValue && {
                maxValue: nestedMetadata.serial.maxValue as unknown as bigint,
              }),
              format:
                "format" in nestedMetadata.serial
                  ? nestedMetadata.serial.format
                  : undefined,
            },
          }),
        };
      }
    },
  );

  return nestedFields;
}

function protoPermission(
  permission: StandardTailorTypePermission,
): MessageInitShape<typeof TailorDBType_PermissionSchema> {
  const ret: MessageInitShape<typeof TailorDBType_PermissionSchema> = {};
  for (const [key, policies] of Object.entries(permission)) {
    ret[key as keyof StandardTailorTypePermission] = policies.map((policy) =>
      protoPolicy(policy),
    );
  }
  return ret;
}

function protoPolicy(
  policy: StandardActionPermission<"record">,
): MessageInitShape<typeof TailorDBType_Permission_PolicySchema> {
  let permit: TailorDBType_Permission_Permit;
  switch (policy.permit) {
    case "allow":
      permit = TailorDBType_Permission_Permit.ALLOW;
      break;
    case "deny":
      permit = TailorDBType_Permission_Permit.DENY;
      break;
    default:
      throw new Error(`Unknown permission: ${policy.permit satisfies never}`);
  }
  return {
    conditions: policy.conditions.map((cond) => protoCondition(cond)),
    permit,
    description: policy.description,
  };
}

function protoCondition(
  condition: StandardPermissionCondition<"record">,
): MessageInitShape<typeof TailorDBType_Permission_ConditionSchema> {
  const [left, operator, right] = condition;

  const l = protoOperand(left);
  const r = protoOperand(right);
  let op: TailorDBType_Permission_Operator;
  switch (operator) {
    case "eq":
      op = TailorDBType_Permission_Operator.EQ;
      break;
    case "ne":
      op = TailorDBType_Permission_Operator.NE;
      break;
    case "in":
      op = TailorDBType_Permission_Operator.IN;
      break;
    case "nin":
      op = TailorDBType_Permission_Operator.NIN;
      break;
    default:
      throw new Error(`Unknown operator: ${operator satisfies never}`);
  }
  return {
    left: l,
    operator: op,
    right: r,
  };
}

function protoOperand(
  operand: PermissionOperand<
    "record",
    Record<string, unknown>,
    Record<string, unknown>
  >,
): MessageInitShape<typeof TailorDBType_Permission_OperandSchema> {
  if (typeof operand === "object" && !Array.isArray(operand)) {
    if ("user" in operand) {
      return {
        kind: {
          case: "userField",
          value: operand.user,
        },
      };
    } else if ("record" in operand) {
      return {
        kind: {
          case: "recordField",
          value: operand.record,
        },
      };
    } else if ("newRecord" in operand) {
      return {
        kind: {
          case: "newRecordField",
          value: operand.newRecord,
        },
      };
    } else if ("oldRecord" in operand) {
      return {
        kind: {
          case: "oldRecordField",
          value: operand.oldRecord,
        },
      };
    } else {
      throw new Error(`Unknown operand: ${operand satisfies never}`);
    }
  }

  return {
    kind: {
      case: "value",
      value: fromJson(ValueSchema, operand),
    },
  };
}

type CreateGqlPermission = {
  name: string;
  request: MessageInitShape<typeof CreateTailorDBGQLPermissionRequestSchema>;
};

type UpdateGqlPermission = {
  name: string;
  request: MessageInitShape<typeof UpdateTailorDBGQLPermissionRequestSchema>;
};

type DeleteGqlPermission = {
  tag: "gql-permission-deleted";
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBGQLPermissionRequestSchema>;
};

async function planGqlPermissions(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBService>,
  deletedServices: ReadonlyArray<string>,
) {
  const changeSet: ChangeSet<
    CreateGqlPermission,
    UpdateGqlPermission,
    DeleteGqlPermission | ServiceDeleted
  > = new ChangeSet("TailorDB gqlPermissions");

  const fetchGqlPermissions = (namespaceName: string) => {
    return fetchAll(async (pageToken) => {
      try {
        const { permissions, nextPageToken } =
          await client.listTailorDBGQLPermissions({
            workspaceId,
            namespaceName,
            pageToken,
          });
        return [permissions, nextPageToken];
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return [[], ""];
        }
        throw error;
      }
    });
  };

  for (const tailordb of tailordbs) {
    const existingGqlPermissions = await fetchGqlPermissions(
      tailordb.namespace,
    );
    const existingNameSet = new Set<string>();
    existingGqlPermissions.forEach((gqlPermission) => {
      existingNameSet.add(gqlPermission.typeName);
    });
    for (const fileTypes of Object.values(tailordb.getTypes())) {
      for (const typ of Object.values(fileTypes)) {
        const gqlPermission = typ.metadata.schema.permissions.gql;
        if (!gqlPermission) {
          continue;
        }
        if (existingNameSet.has(typ.name)) {
          changeSet.updates.push({
            name: typ.name,
            request: {
              workspaceId,
              namespaceName: tailordb.namespace,
              typeName: typ.name,
              permission: protoGqlPermission(gqlPermission),
            },
          });
          existingNameSet.delete(typ.name);
        } else {
          changeSet.creates.push({
            name: typ.name,
            request: {
              workspaceId,
              namespaceName: tailordb.namespace,
              typeName: typ.name,
              permission: protoGqlPermission(gqlPermission),
            },
          });
        }
      }
    }
    existingNameSet.forEach((name) => {
      changeSet.deletes.push({
        tag: "gql-permission-deleted",
        name,
        request: {
          workspaceId,
          namespaceName: tailordb.namespace,
          typeName: name,
        },
      });
    });
  }
  for (const namespaceName of deletedServices) {
    const existingGqlPermissions = await fetchGqlPermissions(namespaceName);
    existingGqlPermissions.forEach((gqlPermission) => {
      changeSet.deletes.push({
        tag: "service-deleted",
        name: gqlPermission.typeName,
      });
    });
  }
  return changeSet;
}

function protoGqlPermission(
  permission: StandardTailorTypeGqlPermission,
): MessageInitShape<typeof TailorDBGQLPermissionSchema> {
  return {
    policies: permission.map((policy) => protoGqlPolicy(policy)),
  };
}

function protoGqlPolicy(
  policy: StandardGqlPermissionPolicy,
): MessageInitShape<typeof TailorDBGQLPermission_PolicySchema> {
  const actions: TailorDBGQLPermission_Action[] = [];
  for (const action of policy.actions) {
    switch (action) {
      case "all":
        actions.push(TailorDBGQLPermission_Action.ALL);
        break;
      case "create":
        actions.push(TailorDBGQLPermission_Action.CREATE);
        break;
      case "read":
        actions.push(TailorDBGQLPermission_Action.READ);
        break;
      case "update":
        actions.push(TailorDBGQLPermission_Action.UPDATE);
        break;
      case "delete":
        actions.push(TailorDBGQLPermission_Action.DELETE);
        break;
      case "aggregate":
        actions.push(TailorDBGQLPermission_Action.AGGREGATE);
        break;
      case "bulkUpsert":
        actions.push(TailorDBGQLPermission_Action.BULK_UPSERT);
        break;
      default:
        throw new Error(`Unknown action: ${action satisfies never}`);
    }
  }
  let permit: TailorDBGQLPermission_Permit;
  switch (policy.permit) {
    case "allow":
      permit = TailorDBGQLPermission_Permit.ALLOW;
      break;
    case "deny":
      permit = TailorDBGQLPermission_Permit.DENY;
      break;
    default:
      throw new Error(`Unknown permission: ${policy.permit satisfies never}`);
  }
  return {
    conditions: policy.conditions.map((cond) => protoGqlCondition(cond)),
    actions,
    permit,
    description: policy.description,
  };
}

function protoGqlCondition(
  condition: StandardPermissionCondition<"gql">,
): MessageInitShape<typeof TailorDBGQLPermission_ConditionSchema> {
  const [left, operator, right] = condition;

  const l = protoGqlOperand(left);
  const r = protoGqlOperand(right);
  let op: TailorDBGQLPermission_Operator;
  switch (operator) {
    case "eq":
      op = TailorDBGQLPermission_Operator.EQ;
      break;
    case "ne":
      op = TailorDBGQLPermission_Operator.NE;
      break;
    case "in":
      op = TailorDBGQLPermission_Operator.IN;
      break;
    case "nin":
      op = TailorDBGQLPermission_Operator.NIN;
      break;
    default:
      throw new Error(`Unknown operator: ${operator satisfies never}`);
  }
  return {
    left: l,
    operator: op,
    right: r,
  };
}

function protoGqlOperand(
  operand: PermissionOperand<
    "gql",
    Record<string, unknown>,
    Record<string, unknown>
  >,
): MessageInitShape<typeof TailorDBGQLPermission_OperandSchema> {
  if (typeof operand === "object" && !Array.isArray(operand)) {
    if ("user" in operand) {
      return {
        kind: {
          case: "userField",
          value: operand.user,
        },
      };
    } else {
      throw new Error(`Unknown operand: ${operand satisfies never}`);
    }
  }

  return {
    kind: {
      case: "value",
      value: fromJson(ValueSchema, operand),
    },
  };
}
