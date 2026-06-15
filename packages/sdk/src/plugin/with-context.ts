/**
 * Plugin executor context support for defining plugin executors in separate files.
 * This module provides utilities for creating type-safe plugin executors that receive
 * context (like type references and namespace) at runtime.
 */

import type { TailorEnv, TailorPrincipal } from "@/types/runtime";

/**
 * Plugin executor factory function type.
 * Takes context and returns an executor configuration.
 * Returns unknown since the exact return type depends on createExecutor's generic params.
 */
export type PluginExecutorFactory<Ctx> = (ctx: Ctx) => unknown;

// ============================================================================
// Plugin Executor Args Types
// ============================================================================

/**
 * Base args for plugin executor function operations.
 * Provides typed access to runtime context without requiring specific record types.
 */
export interface PluginFunctionArgs {
  /** Workspace ID where the executor runs */
  workspaceId: string;
  /** Application namespace */
  appNamespace: string;
  /** Environment variables */
  env: TailorEnv;
  /** Principal that triggered the event, null for system events */
  actor: TailorPrincipal | null;
  /** Name of the TailorDB type */
  typeName: string;
  /** TailorDB connections by namespace */
  tailordb: Record<string, unknown>;
}

/**
 * Args for plugin executors triggered on record creation.
 */
export interface PluginRecordCreatedArgs extends PluginFunctionArgs {
  /** The newly created record */
  newRecord: Record<string, unknown>;
}

/**
 * Args for plugin executors triggered on record update.
 */
export interface PluginRecordUpdatedArgs extends PluginFunctionArgs {
  /** The record after update */
  newRecord: Record<string, unknown>;
  /** The record before update */
  oldRecord: Record<string, unknown>;
}

/**
 * Args for plugin executors triggered on record deletion.
 */
export interface PluginRecordDeletedArgs extends PluginFunctionArgs {
  /** The deleted record */
  oldRecord: Record<string, unknown>;
}

/**
 * Database schema type for plugins.
 * Since plugins work with dynamic types, the schema uses Record types.
 */
export type PluginDBSchema = Record<string, Record<string, unknown>>;

/**
 * Base record type for TailorDB records.
 * All records have an id field.
 */
export type PluginRecord = { id: string } & Record<string, unknown>;

/**
 * Define a plugin executor that receives context at runtime.
 * This allows executor definitions to be in separate files while
 * still receiving dynamic values like typeName, generated types, and namespace.
 * @param factory - Function that takes context and returns executor configuration
 * @returns The same factory function (for type inference)
 * @example
 * ```typescript
 * // executors/on-create.ts
 * import { withPluginContext } from "@tailor-platform/sdk/plugin";
 * import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
 * import { getDB } from "@tailor-platform/function-kysely-tailordb";
 *
 * interface MyContext {
 *   sourceType: TailorAnyDBType;
 *   historyType: TailorAnyDBType;
 *   namespace: string;
 * }
 *
 * export default withPluginContext<MyContext>((ctx) =>
 *   createExecutor({
 *     name: `${ctx.sourceType.name.toLowerCase()}-on-create`,
 *     trigger: recordCreatedTrigger({ type: ctx.sourceType }),
 *     operation: {
 *       kind: "function",
 *       body: async (args) => {
 *         const db = getDB(ctx.namespace);
 *         await db.insertInto(ctx.historyType.name).values({
 *           recordId: args.newRecord.id,
 *           // ...
 *         }).execute();
 *       },
 *     },
 *   })
 * );
 * ```
 */
export function withPluginContext<Ctx>(
  factory: PluginExecutorFactory<Ctx>,
): PluginExecutorFactory<Ctx> {
  return factory;
}
