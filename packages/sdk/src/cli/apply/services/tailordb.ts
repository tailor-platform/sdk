import { fromJson, type MessageInitShape } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type CreateTailorDBGQLPermissionRequestSchema,
  type CreateTailorDBServiceRequestSchema,
  type CreateTailorDBTypeRequestSchema,
  type DeleteTailorDBGQLPermissionRequestSchema,
  type DeleteTailorDBServiceRequestSchema,
  type DeleteTailorDBTypeRequestSchema,
  type UpdateTailorDBGQLPermissionRequestSchema,
  type UpdateTailorDBTypeRequestSchema,
} from "@tailor-proto/tailor/v1/tailordb_pb";
import {
  TailorDBGQLPermission_Action,
  type TailorDBGQLPermission_ConditionSchema,
  type TailorDBGQLPermission_OperandSchema,
  TailorDBGQLPermission_Operator,
  TailorDBGQLPermission_Permit,
  type TailorDBGQLPermission_PolicySchema,
  type TailorDBGQLPermissionSchema,
  type TailorDBType_FieldConfigSchema,
  type TailorDBType_FileConfigSchema,
  type TailorDBType_IndexSchema,
  type TailorDBType_Permission_ConditionSchema,
  type TailorDBType_Permission_OperandSchema,
  TailorDBType_Permission_Operator,
  TailorDBType_Permission_Permit,
  type TailorDBType_Permission_PolicySchema,
  type TailorDBType_PermissionSchema,
  TailorDBType_PermitAction,
  type TailorDBType_RelationshipConfigSchema,
  type TailorDBTypeSchema,
} from "@tailor-proto/tailor/v1/tailordb_resource_pb";
import * as inflection from "inflection";
import { type TailorDBService } from "@/cli/application/tailordb/service";
import {
  type PermissionOperand,
  type StandardActionPermission,
  type StandardGqlPermissionPolicy,
  type StandardPermissionCondition,
  type StandardTailorTypeGqlPermission,
  type StandardTailorTypePermission,
} from "@/configure/services/tailordb/permission";
import { type ApplyPhase, type PlanContext } from "..";
import { fetchAll, type OperatorClient } from "../../client";
import {
  confirmOwnershipConflicts,
  confirmUnlabeledResources,
  type OwnershipConflict,
  type UnlabeledResource,
} from "./confirm";
import {
  buildMetaRequest,
  sdkNameLabelKey,
  trnPrefix,
  type WithLabel,
} from "./label";
import { ChangeSet } from ".";
import type { TailorDBTypeConfig } from "@/configure/services/tailordb/operator-types";
import type { Executor } from "@/parser/service/executor";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";

export async function applyTailorDB(
  client: OperatorClient,
  changeSet: Awaited<ReturnType<typeof planTailorDB>>,
  phase: ApplyPhase = "create-update",
) {
  if (phase === "create-update") {
    // Services
    await Promise.all([
      ...changeSet.service.creates.map(async (create) => {
        await client.createTailorDBService(create.request);
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.service.updates.map((update) =>
        client.setMetadata(update.metaRequest),
      ),
    ]);

    // Types
    await Promise.all([
      ...changeSet.type.creates.map((create) =>
        client.createTailorDBType(create.request),
      ),
      ...changeSet.type.updates.map((update) =>
        client.updateTailorDBType(update.request),
      ),
    ]);

    // GQLPermissions
    await Promise.all([
      ...changeSet.gqlPermission.creates.map((create) =>
        client.createTailorDBGQLPermission(create.request),
      ),
      ...changeSet.gqlPermission.updates.map((update) =>
        client.updateTailorDBGQLPermission(update.request),
      ),
    ]);
  } else if (phase === "delete") {
    // Delete in reverse order of dependencies
    // GQLPermissions
    await Promise.all(
      changeSet.gqlPermission.deletes.map((del) =>
        client.deleteTailorDBGQLPermission(del.request),
      ),
    );

    // Types
    await Promise.all(
      changeSet.type.deletes.map((del) =>
        client.deleteTailorDBType(del.request),
      ),
    );

    // Services
    await Promise.all(
      changeSet.service.deletes.map((del) =>
        client.deleteTailorDBService(del.request),
      ),
    );
  }
}

export async function planTailorDB({
  client,
  workspaceId,
  application,
  yes,
}: PlanContext) {
  const tailordbs: TailorDBService[] = [];
  for (const tailordb of application.tailorDBServices) {
    await tailordb.loadTypes();
    tailordbs.push(tailordb);
  }
  const executors = Object.values(
    (await application.executorService?.loadExecutors()) ?? {},
  );

  const serviceChangeSet = await planServices(
    client,
    workspaceId,
    application.name,
    tailordbs,
    yes,
  );
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
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateService = {
  name: string;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteService = {
  name: string;
  request: MessageInitShape<typeof DeleteTailorDBServiceRequestSchema>;
};

function trn(workspaceId: string, name: string) {
  return `${trnPrefix(workspaceId)}:tailordb:${name}`;
}

async function planServices(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  tailordbs: ReadonlyArray<TailorDBService>,
  yes: boolean,
) {
  const changeSet: ChangeSet<CreateService, UpdateService, DeleteService> =
    new ChangeSet("TailorDB services");
  const conflicts: OwnershipConflict[] = [];
  const unlabeled: UnlabeledResource[] = [];

  const withoutLabel = await fetchAll(async (pageToken) => {
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

  for (const tailordb of tailordbs) {
    const existing = existingServices[tailordb.namespace];
    const metaRequest = await buildMetaRequest(
      trn(workspaceId, tailordb.namespace),
      appName,
    );
    if (existing) {
      if (!existing.label) {
        unlabeled.push({
          resourceType: "TailorDB service",
          resourceName: tailordb.namespace,
        });
      } else if (existing.label !== appName) {
        conflicts.push({
          resourceType: "TailorDB service",
          resourceName: tailordb.namespace,
          currentOwner: existing.label,
          newOwner: appName,
        });
      }

      changeSet.updates.push({
        name: tailordb.namespace,
        metaRequest,
      });
      delete existingServices[tailordb.namespace];
    } else {
      changeSet.creates.push({
        name: tailordb.namespace,
        request: {
          workspaceId,
          namespaceName: tailordb.namespace,
          // Set UTC to match tailorctl/terraform
          defaultTimezone: "UTC",
        },
        metaRequest,
      });
    }
  }
  Object.entries(existingServices).forEach(([namespaceName]) => {
    // Only delete services managed by this application
    if (existingServices[namespaceName]?.label === appName) {
      changeSet.deletes.push({
        name: namespaceName,
        request: {
          workspaceId,
          namespaceName,
        },
      });
    }
  });

  // Confirm ownership conflicts and unlabeled resources
  await confirmOwnershipConflicts(conflicts, yes);
  await confirmUnlabeledResources(unlabeled, yes);

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
  const changeSet: ChangeSet<CreateType, UpdateType, DeleteType> =
    new ChangeSet("TailorDB types");

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
    if (
      executor.trigger.kind === "recordCreated" ||
      executor.trigger.kind === "recordUpdated" ||
      executor.trigger.kind === "recordDeleted"
    ) {
      executorUsedTypes.add(executor.trigger.typeName);
    }
  }

  for (const tailordb of tailordbs) {
    const existingTypes = await fetchTypes(tailordb.namespace);
    const existingNameSet = new Set<string>();
    existingTypes.forEach((type) => existingNameSet.add(type.name));

    const types = tailordb.getTypes();
    for (const typeName of Object.keys(types)) {
      const tailordbType = generateTailorDBTypeManifest(
        types[typeName],
        executorUsedTypes,
      );
      if (existingNameSet.has(typeName)) {
        changeSet.updates.push({
          name: typeName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            tailordbType,
          },
        });
        existingNameSet.delete(typeName);
      } else {
        changeSet.creates.push({
          name: typeName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            tailordbType,
          },
        });
      }
    }
    existingNameSet.forEach((name) => {
      changeSet.deletes.push({
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
        name: typ.name,
        request: {
          workspaceId,
          namespaceName,
          tailordbTypeName: typ.name,
        },
      });
    });
  }
  return changeSet;
}

// TODO(remiposo): Copied the type-processor / aggregator processing almost as-is.
// This will need refactoring later.
function generateTailorDBTypeManifest(
  type: ParsedTailorDBType,
  executorUsedTypes: ReadonlySet<string>,
): MessageInitShape<typeof TailorDBTypeSchema> {
  // This ensures that explicitly provided pluralForm like "PurchaseOrderList" becomes "purchaseOrderList"
  const pluralForm = inflection.camelize(type.pluralForm, true);

  const defaultSettings = {
    aggregation: type.settings?.aggregation || false,
    bulkUpsert: type.settings?.bulkUpsert || false,
    draft: false,
    defaultQueryLimitSize: 100n,
    maxBulkUpsertSize: 1000n,
    pluralForm,
    publishRecordEvents: false,
  };
  if (executorUsedTypes.has(type.name)) {
    defaultSettings.publishRecordEvents = true;
  }

  const fields: Record<
    string,
    MessageInitShape<typeof TailorDBType_FieldConfigSchema>
  > = {};

  Object.keys(type.fields)
    .filter((fieldName) => fieldName !== "id")
    .forEach((fieldName) => {
      const fieldConfig = type.fields[fieldName].config;
      const fieldType = fieldConfig.type;
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
        foreignKeyField: fieldConfig.foreignKeyField,
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

      // Handle nested fields
      if (fieldConfig.type === "nested" && fieldConfig.fields) {
        fieldEntry.fields = processNestedFields(fieldConfig.fields);
      }

      fields[fieldName] = fieldEntry;
    });

  const relationships: Record<
    string,
    MessageInitShape<typeof TailorDBType_RelationshipConfigSchema>
  > = {};

  for (const [relationName, rel] of Object.entries(type.forwardRelationships)) {
    relationships[relationName] = {
      refType: rel.targetType,
      refField: rel.sourceField,
      srcField: rel.targetField,
      array: rel.isArray,
      description: rel.description,
    };
  }

  for (const [relationName, rel] of Object.entries(
    type.backwardRelationships,
  )) {
    relationships[relationName] = {
      refType: rel.targetType,
      refField: rel.targetField,
      srcField: rel.sourceField,
      array: rel.isArray,
      description: rel.description,
    };
  }

  // Process indexes from metadata
  const indexes: Record<
    string,
    MessageInitShape<typeof TailorDBType_IndexSchema>
  > = {};
  if (type.indexes) {
    Object.entries(type.indexes).forEach(([key, index]) => {
      indexes[key] = {
        fieldNames: index.fields,
        unique: index.unique || false,
      };
    });
  }

  // Process files from metadata
  const files: Record<
    string,
    MessageInitShape<typeof TailorDBType_FileConfigSchema>
  > = {};
  if (type.files) {
    Object.entries(type.files).forEach(([key, description]) => {
      files[key] = { description: description || "" };
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
  const permission = type.permissions.record
    ? protoPermission(type.permissions.record)
    : defaultPermission;

  return {
    name: type.name,
    schema: {
      description: type.description || "",
      fields,
      relationships: relationships,
      settings: defaultSettings,
      extends: false,
      directives: [],
      indexes,
      files,
      permission,
    },
  };
}

function processNestedFields(
  fields: Record<string, TailorDBTypeConfig["schema"]["fields"][string]>,
): Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>> {
  const nestedFields: Record<
    string,
    MessageInitShape<typeof TailorDBType_FieldConfigSchema>
  > = {};

  Object.entries(fields).forEach(([nestedFieldName, nestedFieldConfig]) => {
    const nestedType = nestedFieldConfig.type;

    if (nestedType === "nested" && nestedFieldConfig.fields) {
      const deepNestedFields = processNestedFields(nestedFieldConfig.fields);
      nestedFields[nestedFieldName] = {
        type: "nested",
        allowedValues: nestedFieldConfig.allowedValues || [],
        description: nestedFieldConfig.description || "",
        validate: [],
        required: nestedFieldConfig.required ?? true,
        array: nestedFieldConfig.array ?? false,
        index: false,
        unique: false,
        foreignKey: false,
        vector: false,
        fields: deepNestedFields,
      };
    } else {
      nestedFields[nestedFieldName] = {
        type: nestedType,
        allowedValues:
          nestedType === "enum" ? nestedFieldConfig.allowedValues || [] : [],
        description: nestedFieldConfig.description || "",
        validate: [],
        required: nestedFieldConfig.required ?? true,
        array: nestedFieldConfig.array ?? false,
        index: false,
        unique: false,
        foreignKey: false,
        vector: false,
        ...(nestedFieldConfig.serial && {
          serial: {
            start: nestedFieldConfig.serial.start as unknown as bigint,
            ...(nestedFieldConfig.serial.maxValue && {
              maxValue: nestedFieldConfig.serial.maxValue as unknown as bigint,
            }),
            ...(nestedFieldConfig.serial.format && {
              format: nestedFieldConfig.serial.format,
            }),
          },
        }),
      };
    }
  });

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
    DeleteGqlPermission
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

    const types = tailordb.getTypes();
    for (const typeName of Object.keys(types)) {
      const gqlPermission = types[typeName].permissions.gql;
      if (!gqlPermission) {
        continue;
      }
      if (existingNameSet.has(typeName)) {
        changeSet.updates.push({
          name: typeName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            typeName: typeName,
            permission: protoGqlPermission(gqlPermission),
          },
        });
        existingNameSet.delete(typeName);
      } else {
        changeSet.creates.push({
          name: typeName,
          request: {
            workspaceId,
            namespaceName: tailordb.namespace,
            typeName: typeName,
            permission: protoGqlPermission(gqlPermission),
          },
        });
      }
    }
    existingNameSet.forEach((name) => {
      changeSet.deletes.push({
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
        name: gqlPermission.typeName,
        request: {
          workspaceId,
          namespaceName,
          typeName: gqlPermission.typeName,
        },
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
