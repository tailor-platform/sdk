/**
 * JS expressions that shape the inputs passed to user-authored code.
 *
 * Two delivery paths:
 * - Apply config: shipped with apply and evaluated by the platform before
 *   invoking user code.
 * - Bundle inline: interpolated into the generated `.entry.js` wrapper and
 *   evaluated inside the bundled script at function entry.
 *
 * The principal field mapping (server → SDK) shared across services is built by
 * `makePrincipalExpr` from `@/parser/service/tailordb`; `tailorPrincipalMap`
 * (the `caller` mapping) is one of its outputs. `INVOKER_EXPR` and
 * `ACTOR_TRANSFORM_EXPR` below come from the same factory so the three stay in
 * sync.
 */
import { makePrincipalExpr, tailorPrincipalMap } from "@/parser/service/tailordb";
import type { Trigger } from "@/types/executor.generated";

// ---------------------------------------------------------------------------
// Bundle inline
// ---------------------------------------------------------------------------

/**
 * `invoker` value expression, inlined into bundler entry wrappers.
 *
 * Calls `tailor.context.getInvoker()` at function entry and maps the server
 * shape to `TailorPrincipal | null`. The payload is already in SDK type shape,
 * so no `USER_TYPE_*` normalization is needed; anonymous callers (`null`) pass
 * through as `null`.
 */
export const INVOKER_EXPR = makePrincipalExpr({
  source: "tailor.context.getInvoker()",
  normalize: false,
  fields: {
    type: { raw: "$raw.type" },
    id: "$raw.id",
    workspaceId: "$raw.workspaceId",
    attributes: "$raw.attributeMap",
    attributeList: "$raw.attributes",
  },
});

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Actor field transformation expression.
 *
 * Transforms the server's actor object to match `TailorPrincipal | null`.
 */
const ACTOR_TRANSFORM_EXPR = `actor: ${makePrincipalExpr({
  source: "args.actor",
  normalize: true,
  requireId: true,
  fields: {
    type: { raw: "$raw?.userType", fallback: "$raw?.type" },
    id: "$raw?.userId ?? $raw?.id",
    workspaceId: "$raw.workspaceId",
    attributes: "$raw.attributeMap ?? {}",
    attributeList: "$raw.attributes ?? []",
  },
})}`;

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
