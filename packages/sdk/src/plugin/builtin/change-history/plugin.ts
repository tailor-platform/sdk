/**
 * Change History Plugin
 *
 * A type-attached plugin that tracks change history for TailorDB types.
 * When attached to a type, it generates:
 * 1. A {TypeName}History type to store change records
 * 2. Three executors to capture CREATE, UPDATE, DELETE events
 */

import { db } from "@/configure/services/tailordb";
import { t } from "@/configure/types";
import {
  createPluginExecutor,
  pluginRecordCreatedTrigger,
  pluginRecordUpdatedTrigger,
  pluginRecordDeletedTrigger,
} from "@/parser/plugin-config";
import type { TailorAnyDBType } from "@/configure/services/tailordb/schema";
import type { PluginBase, PluginProcessContext, PluginOutput } from "@/parser/plugin-config/types";

/**
 * Generated type kinds for change-history plugin.
 */
export type GeneratedTypeKind = "history";

/**
 * Configuration schema for change-history plugin.
 * Uses a simple boolean to enable/disable.
 */
const configSchema = t.bool().validate(({ value }) => value === true);

/**
 * Generate history type for a source type.
 * @param type - The source TailorDB type
 * @returns Map of kind to generated type
 */
function generateTypes(type: TailorAnyDBType): Record<GeneratedTypeKind, TailorAnyDBType> {
  const typeName = type.name;

  const historyType = db
    .type(`${typeName}History`, {
      recordId: db.uuid().index().description("ID of the tracked record"),
      action: db
        .enum(["CREATE", "UPDATE", "DELETE"])
        .index()
        .description("The action performed on the record"),
      performedBy: db
        .uuid({ optional: true })
        .index()
        .description("User ID who performed the action"),
      performedAt: db.datetime().index().description("When the action was performed"),
      previousValues: db
        .string({ optional: true })
        .description("JSON snapshot of the record before the change"),
      newValues: db
        .string({ optional: true })
        .description("JSON snapshot of the record after the change"),
      changedFields: db
        .string({ optional: true })
        .description("JSON array of field names that changed"),
      ...db.fields.timestamps(),
    })
    .description(`Change history for ${typeName}`)
    .indexes({
      name: `idx_${typeName.toLowerCase()}_history_record`,
      fields: ["recordId", "action"],
    })
    .permission({
      create: [[{ user: "_loggedIn" }, "=", true]],
      read: [[{ user: "_loggedIn" }, "=", true]],
      update: [[{ user: "_loggedIn" }, "=", true]],
      delete: [[{ user: "_loggedIn" }, "=", true]],
    })
    .gqlPermission([
      {
        actions: ["create", "read", "update", "delete"],
        permit: true,
        conditions: [[{ user: "_loggedIn" }, "=", true]],
      },
    ]);

  return { history: historyType };
}

/**
 * Generate executors for tracking changes to the source type.
 * @param type - The source TailorDB type
 * @param _namespace - The namespace for the TailorDB types
 * @returns Array of executor definitions
 */
function generateExecutors(type: TailorAnyDBType, _namespace: string) {
  const typeName = type.name;
  const historyTypeName = `${typeName}History`;

  // GraphQL mutation template for inserting history records
  const createMutation = `
    mutation Create${historyTypeName}($input: ${historyTypeName}CreateInput!) {
      create${historyTypeName}(input: $input) {
        id
      }
    }
  `;

  return [
    // CREATE executor
    createPluginExecutor({
      name: `${typeName.toLowerCase()}-history-on-create`,
      description: `Records creation history for ${typeName}`,
      trigger: pluginRecordCreatedTrigger({ type }),
      operation: {
        kind: "graphql",
        query: createMutation,
        variables: (args) => ({
          input: {
            recordId: args.newRecord.id,
            action: "CREATE",
            performedBy: args.actor?.userId ?? null,
            performedAt: new Date().toISOString(),
            previousValues: null,
            newValues: JSON.stringify(args.newRecord),
            changedFields: JSON.stringify(Object.keys(args.newRecord)),
          },
        }),
      },
    }),
    // UPDATE executor
    createPluginExecutor({
      name: `${typeName.toLowerCase()}-history-on-update`,
      description: `Records update history for ${typeName}`,
      trigger: pluginRecordUpdatedTrigger({ type }),
      operation: {
        kind: "graphql",
        query: createMutation,
        variables: (args) => {
          const changedFields: string[] = [];
          for (const key of Object.keys(args.newRecord)) {
            if (JSON.stringify(args.newRecord[key]) !== JSON.stringify(args.oldRecord[key])) {
              changedFields.push(key);
            }
          }
          return {
            input: {
              recordId: args.newRecord.id,
              action: "UPDATE",
              performedBy: args.actor?.userId ?? null,
              performedAt: new Date().toISOString(),
              previousValues: JSON.stringify(args.oldRecord),
              newValues: JSON.stringify(args.newRecord),
              changedFields: JSON.stringify(changedFields),
            },
          };
        },
      },
    }),
    // DELETE executor
    createPluginExecutor({
      name: `${typeName.toLowerCase()}-history-on-delete`,
      description: `Records deletion history for ${typeName}`,
      trigger: pluginRecordDeletedTrigger({ type }),
      operation: {
        kind: "graphql",
        query: createMutation,
        variables: (args) => ({
          input: {
            recordId: args.oldRecord.id,
            action: "DELETE",
            performedBy: args.actor?.userId ?? null,
            performedAt: new Date().toISOString(),
            previousValues: JSON.stringify(args.oldRecord),
            newValues: null,
            changedFields: null,
          },
        }),
      },
    }),
  ];
}

/**
 * Get a generated type for a source type.
 * @param sourceType - The original type that the plugin is applied to
 * @param kind - The kind of generated type to retrieve
 * @returns The generated TailorDB type
 */
export function getGeneratedType(
  sourceType: TailorAnyDBType,
  kind: GeneratedTypeKind,
): TailorAnyDBType {
  return generateTypes(sourceType)[kind];
}

/**
 * Process a type and generate change history tracking.
 * @param context - Plugin processing context containing the type to process
 * @returns Plugin output with generated history type and executors
 */
function processChangeHistory(context: PluginProcessContext<boolean>): PluginOutput {
  const { type, config, namespace } = context;
  if (!config) {
    return { types: {} };
  }

  return {
    types: generateTypes(type),
    executors: generateExecutors(type, namespace),
  };
}

/**
 * Change history plugin for tracking record changes.
 *
 * When applied to a type via `.plugin({ "@tailor-platform/change-history": true })`:
 * 1. Generates a {TypeName}History type to store change records
 * 2. Generates 3 executors to capture CREATE, UPDATE, DELETE events
 * @example
 * ```typescript
 * const user = db.type("User", {
 *   name: db.string(),
 *   email: db.string(),
 * }).plugin({ "@tailor-platform/change-history": true });
 * ```
 */
export const changeHistoryPlugin: PluginBase = {
  id: "@tailor-platform/change-history",
  description: "Tracks change history for TailorDB types",
  importPath: "@tailor-platform/sdk/change-history-plugin",
  configSchema,
  process: processChangeHistory,
};
