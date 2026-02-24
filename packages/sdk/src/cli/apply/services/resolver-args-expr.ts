import { tailorUserMap } from "@/parser/service/tailordb";

/**
 * Build the operationHook expression for resolver pipelines.
 *
 * Transforms server context to SDK resolver context:
 *   context.args        → input
 *   context.pipeline     → spread into result
 *   user (global var)    → TailorUser (via tailorUserMap: workspace_id→workspaceId, attribute_map→attributes, attributes→attributeList)
 *   env                 → injected as JSON
 * @param env - Application env record to embed in the expression
 * @returns A JavaScript expression string for the operationHook
 */
export function buildResolverOperationHookExpr(
  env: Record<string, string | number | boolean>,
): string {
  return `({ ...context.pipeline, input: context.args, user: ${tailorUserMap}, env: ${JSON.stringify(env)} });`;
}
