import type { Trigger } from "@/parser/service/executor";

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
