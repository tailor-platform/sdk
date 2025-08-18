import { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import {
  CreateTailorDBServiceRequestSchema,
  CreateTailorDBTypeRequestSchema,
  DeleteTailorDBServiceRequestSchema,
  DeleteTailorDBTypeRequestSchema,
  UpdateTailorDBTypeRequestSchema,
} from "@/gen/tailor/v1/tailordb_pb";
import {
  TailorDBType_FieldConfigSchema,
  TailorDBType_IndexSchema,
  TailorDBType_PermitAction,
  TailorDBType_RelationshipConfigSchema,
  TailorDBTypeSchema,
} from "@/gen/tailor/v1/tailordb_resource_pb";
import { ApplyOptions } from "@/generator/options";
import { ExecutorService } from "@/services";
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

  // Services
  for (const create of changeSet.service.creates) {
    await client.createTailorDBService(create.request);
  }
  for (const del of changeSet.service.deletes) {
    await client.deleteTailorDBService(del.request);
  }

  // Types
  for (const create of changeSet.type.creates) {
    await client.createTailorDBType(create.request);
  }
  for (const update of changeSet.type.updates) {
    await client.updateTailorDBType(update.request);
  }
  for (const del of changeSet.type.deletes) {
    if (del.tag === "type-deleted") {
      await client.deleteTailorDBType(del.request);
    }
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
      tailordbs.push(tailordb);
    }
  }
  const serviceChangeSet = await planServices(client, workspaceId, tailordbs);
  const deletedServices = serviceChangeSet.deletes.map((del) => del.name);
  const typeChangeSet = await planTypes(
    client,
    workspaceId,
    tailordbs,
    workspace.executorService,
    deletedServices,
  );

  serviceChangeSet.print();
  typeChangeSet.print();
  return {
    service: serviceChangeSet,
    type: typeChangeSet,
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

type ServiceDeleted = {
  tag: "service-deleted";
  name: string;
};

async function planTypes(
  client: OperatorClient,
  workspaceId: string,
  tailordbs: ReadonlyArray<TailorDBService>,
  executor: Readonly<ExecutorService> | undefined,
  deletedServices: ReadonlyArray<string>,
) {
  const changeSet: ChangeSet<
    CreateType,
    UpdateType,
    DeleteType | ServiceDeleted
  > = new ChangeSet("TailorDB types");

  const fetchClients = (namespaceName: string) => {
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
  const executors = Object.values((await executor?.loadExecutors()) ?? {});
  for (const executor of executors) {
    const triggerContext = executor.trigger.context;
    if ("type" in triggerContext && triggerContext.type) {
      executorUsedTypes.add(triggerContext.type);
    }
  }

  for (const tailordb of tailordbs) {
    const existingTypes = await fetchClients(tailordb.namespace);
    const existingNameSet = new Set<string>();
    existingTypes.forEach((typ) => {
      existingNameSet.add(typ.name);
    });
    await tailordb.loadTypes();
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
    const existingTypes = await fetchClients(namespaceName);
    existingTypes.forEach((client) => {
      changeSet.deletes.push({
        tag: "service-deleted",
        name: client.name,
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

  const defaultTypePermission = {
    create: [{ id: "everyone", permit: TailorDBType_PermitAction.ALLOW }],
    read: [{ id: "everyone", permit: TailorDBType_PermitAction.ALLOW }],
    update: [{ id: "everyone", permit: TailorDBType_PermitAction.ALLOW }],
    delete: [{ id: "everyone", permit: TailorDBType_PermitAction.ALLOW }],
    admin: [{ id: "everyone", permit: TailorDBType_PermitAction.ALLOW }],
  };

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
      typePermission: defaultTypePermission,
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
