/**
 * JS expressions that shape the inputs passed to user-authored code.
 *
 * Two delivery paths:
 * - Apply config: shipped with apply and evaluated by the platform before
 *   invoking user code.
 * - Bundle inline: interpolated into the generated `.entry.js` wrapper and
 *   evaluated inside the bundled script at function entry.
 *
 * The user field mapping (server → SDK) shared across services is defined in
 * `@/parser/service/tailordb` as `tailorUserMap`.
 */
import { tailorUserMap } from "#/parser/service/tailordb/index";
import type { Trigger } from "#/types/executor.generated";
import type { Resolver } from "#/types/resolver.generated";

// ---------------------------------------------------------------------------
// Bundle inline
// ---------------------------------------------------------------------------

/**
 * `invoker` value expression, inlined into bundler entry wrappers.
 *
 * Calls `tailor.context.getInvoker()` at function entry and maps the server
 * shape to TailorInvoker. Anonymous callers (`null`) pass through as `null`.
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

type ResolverAuthPolicy = Extract<NonNullable<Resolver["auth"]>, { conditions: unknown }>;
type ResolverPermissionOperand = string | boolean | { user: string };
type ResolverPermissionCondition = readonly [
  ResolverPermissionOperand,
  "=" | "!=",
  ResolverPermissionOperand,
];

function isSingleResolverCondition(
  conditions: ResolverAuthPolicy["conditions"],
): conditions is ResolverPermissionCondition {
  return conditions.length === 3 && typeof conditions[1] === "string";
}

function resolverPermissionOperandExpr(operand: ResolverPermissionOperand): string {
  if (typeof operand === "object") {
    if (operand.user === "_loggedIn") {
      return `(context.user.type !== "")`;
    }
    if (operand.user === "id") {
      return `context.user.id`;
    }
    return `context.user.attributes?.[${JSON.stringify(operand.user)}]`;
  }
  return JSON.stringify(operand);
}

function resolverPermissionConditionExpr(condition: ResolverPermissionCondition): string {
  const [left, operator, right] = condition;
  const jsOperator = operator === "=" ? "===" : "!==";
  return `(${resolverPermissionOperandExpr(left)} ${jsOperator} ${resolverPermissionOperandExpr(right)})`;
}

/**
 * Build the auth guard statement injected at resolver entry.
 *
 * Rejects the call with `TailorErrorMessage` when the caller doesn't match
 * `auth`'s conditions, evaluated against `context.user` — the original caller,
 * unaffected by `authInvoker`.
 * @param auth - The resolver's `auth` config
 * @returns A JS `if (...) throw ...;` statement, or `undefined` when `auth` is omitted or `"public"`
 */
export function buildResolverAuthGuardExpr(auth: Resolver["auth"]): string | undefined {
  if (!auth || auth === "public") {
    return undefined;
  }
  const conditions = isSingleResolverCondition(auth.conditions)
    ? [auth.conditions]
    : auth.conditions;
  const combined = conditions.map(resolverPermissionConditionExpr).join(" && ");
  const denyExpr = auth.permit === false ? `(${combined})` : `!(${combined})`;
  const message = auth.description ? `access denied: ${auth.description}` : "access denied";
  return `if (${denyExpr}) { throw new TailorErrorMessage(${JSON.stringify(message)}); }`;
}
