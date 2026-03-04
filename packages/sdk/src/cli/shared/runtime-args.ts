/**
 * Runtime args transformation for all services.
 *
 * Each service transforms server-side args/context into SDK-friendly format:
 * - Executor: server-side expression evaluated by platform before calling function
 * - Resolver: operationHook expression evaluated by platform before calling function
 *
 * The user field mapping (server → SDK) shared across services is defined in
 * `@/parser/service/tailordb` as `tailorUserMap`.
 */
import { tailorUserMap } from "@/parser/service/tailordb";
import type { Trigger } from "@/parser/service/executor";

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Actor field transformation expression.
 *
 * Transforms the server's actor object to match the SDK's TailorActor type:
 *   server `attributeMap`  → SDK `attributes`
 *   server `attributes`    → SDK `attributeList`
 *   other fields           → passed through
 *   null/undefined actor   → null
 */
const ACTOR_TRANSFORM_EXPR =
  `actor: args.actor ? (({ attributeMap, attributes: attrList, ...rest }) => ` +
  `({ ...rest, attributes: attributeMap, attributeList: attrList }))(args.actor) : null`;

/**
 * Build the JavaScript expression that transforms server-format executor event
 * args into SDK-format args at runtime.
 *
 * The Tailor Platform server delivers event args with server-side field names.
 * The SDK exposes different field names to user code. This function produces a
 * JavaScript expression string that performs the mapping when evaluated
 * server-side.
 * @param triggerKind - The trigger kind discriminant from the parsed executor
 * @param env - Application env record to embed in the expression
 * @returns A JavaScript expression string, e.g. `({ ...args, ... })`
 */
export function buildExecutorArgsExpr(
  triggerKind: Trigger["kind"],
  env: Record<string, string | number | boolean>,
): string {
  const envExpr = `env: ${JSON.stringify(env)}`;

  switch (triggerKind) {
    // Event triggers with actor + standard field mapping
    case "schedule":
    case "recordCreated":
    case "recordUpdated":
    case "recordDeleted":
    case "idpUserCreated":
    case "idpUserUpdated":
    case "idpUserDeleted":
    case "authAccessTokenIssued":
    case "authAccessTokenRefreshed":
    case "authAccessTokenRevoked":
      return `({ ...args, appNamespace: args.namespaceName, ${ACTOR_TRANSFORM_EXPR}, ${envExpr} })`;

    // resolverExecuted: actor + success/result/error mapping
    case "resolverExecuted":
      return `({ ...args, appNamespace: args.namespaceName, ${ACTOR_TRANSFORM_EXPR}, success: !!args.succeeded, result: args.succeeded?.result.resolver, error: args.failed?.error, ${envExpr} })`;

    // incomingWebhook: rawBody mapping, no actor
    case "incomingWebhook":
      return `({ ...args, appNamespace: args.namespaceName, rawBody: args.raw_body, ${envExpr} })`;

    default:
      throw new Error(`Unknown trigger kind for args expression: ${triggerKind satisfies never}`);
  }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

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
