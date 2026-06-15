/**
 * JS expressions that shape the inputs passed to user-authored code.
 *
 * Two delivery paths:
 * - Apply config: shipped with apply and evaluated by the platform before
 *   invoking user code.
 * - Bundle inline: interpolated into the generated `.entry.js` wrapper and
 *   evaluated inside the bundled script at function entry.
 *
 * The principal field mapping (server → SDK) shared across services is defined
 * in `@/parser/service/tailordb` as `tailorPrincipalMap`.
 */
import { tailorPrincipalMap } from "@/parser/service/tailordb";
import type { Trigger } from "@/types/executor.generated";

// ---------------------------------------------------------------------------
// Bundle inline
// ---------------------------------------------------------------------------

/**
 * `invoker` value expression, inlined into bundler entry wrappers.
 *
 * Calls `tailor.context.getInvoker()` at function entry and maps the server
 * shape to `TailorPrincipal | null`. Anonymous callers (`null`) pass through
 * as `null`.
 */
export const INVOKER_EXPR = `(($raw) => $raw ? ({
  id: $raw.id,
  type: $raw.type,
  workspaceId: $raw.workspaceId,
  attributes: $raw.attributeMap,
  attributeList: $raw.attributes,
}) : null)(tailor.context.getInvoker())`;

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Actor field transformation expression.
 *
 * Transforms the server's actor object to match `TailorPrincipal | null`.
 */
const ACTOR_TRANSFORM_EXPR = `actor: (($raw) => {
  const type = $raw?.userType === "USER_TYPE_USER"
    ? "user"
    : $raw?.userType === "USER_TYPE_MACHINE_USER"
      ? "machine_user"
      : $raw?.type;
  const id = $raw?.userId ?? $raw?.id;
  if (!$raw || !id || !type || type === "USER_TYPE_UNSPECIFIED" || id === "00000000-0000-0000-0000-000000000000") {
    return null;
  }
  return {
    id,
    type,
    workspaceId: $raw.workspaceId,
    attributes: $raw.attributeMap ?? {},
    attributeList: $raw.attributes ?? [],
  };
})(args.actor)`;

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
    case "schedule":
      return `({ ...args, appNamespace: args.namespaceName, ${ACTOR_TRANSFORM_EXPR}, ${envExpr} })`;

    case "resolverExecuted":
      return `({ ...args, appNamespace: args.namespaceName, ${ACTOR_TRANSFORM_EXPR}, success: !!args.succeeded, result: args.succeeded?.result.resolver, error: args.failed?.error, ${envExpr} })`;

    case "incomingWebhook":
      return `({ ...args, appNamespace: args.namespaceName, rawBody: args.raw_body, ${envExpr} })`;

    default:
      // All event triggers: inject event (short name) and rawEvent (full event type) from server-side eventType
      return `({ ...args, event: args.eventType?.split(".").pop(), rawEvent: args.eventType, appNamespace: args.namespaceName, ${ACTOR_TRANSFORM_EXPR}, ${envExpr} })`;
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
 *   user (global var)    → caller (`TailorPrincipal | null`)
 *   env                 → injected as JSON
 * @param env - Application env record to embed in the expression
 * @returns A JavaScript expression string for the operationHook
 */
export function buildResolverOperationHookExpr(
  env: Record<string, string | number | boolean>,
): string {
  return `({ ...context.pipeline, input: context.args, caller: ${tailorPrincipalMap}, env: ${JSON.stringify(env)} });`;
}
