/**
 * Plugin executor context support for defining plugin executors in separate files.
 * This module provides utilities for creating type-safe plugin executors that receive
 * context (like type references and namespace) at runtime.
 */

/**
 * Plugin executor factory function type.
 * Takes context and returns an executor configuration.
 */
// oxlint-disable-next-line no-explicit-any
export type PluginExecutorFactory<Ctx> = (ctx: Ctx) => any;

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
