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
import type { ChangeHistoryContext, GeneratedTypeKind } from "./types";
import type { TailorAnyDBType } from "@/configure/services/tailordb/schema";
import type {
  PluginBase,
  PluginProcessContext,
  PluginOutput,
  PluginExecutorContext,
} from "@/parser/plugin-config/types";

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
 * Uses the dynamic import executor format with withPluginContext.
 * @param sourceType - The source TailorDB type
 * @param namespace - The namespace for the TailorDB types
 * @param generatedTypes - Generated types from generateTypes
 * @returns Array of executor definitions with dynamic import references
 */
function generateExecutors(
  sourceType: TailorAnyDBType,
  namespace: string,
  generatedTypes: Record<GeneratedTypeKind, TailorAnyDBType>,
): Array<{ name: string; executorExport: string; context: PluginExecutorContext }> {
  const ctx: ChangeHistoryContext = {
    sourceType,
    historyType: generatedTypes.history,
    namespace,
  };

  return [
    {
      name: `${sourceType.name.toLowerCase()}-history-on-create`,
      executorExport: "onCreate",
      context: ctx,
    },
    {
      name: `${sourceType.name.toLowerCase()}-history-on-update`,
      executorExport: "onUpdate",
      context: ctx,
    },
    {
      name: `${sourceType.name.toLowerCase()}-history-on-delete`,
      executorExport: "onDelete",
      context: ctx,
    },
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

  const generatedTypes = generateTypes(type);

  return {
    types: generatedTypes,
    executors: generateExecutors(type, namespace, generatedTypes),
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
