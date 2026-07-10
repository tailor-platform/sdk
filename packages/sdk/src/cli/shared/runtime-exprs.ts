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

type ResolverAuthPolicies = Extract<NonNullable<Resolver["auth"]>, readonly unknown[]>;
type ResolverAuthPolicy = ResolverAuthPolicies[number];
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

function resolverPermissionPolicyExpr(policy: ResolverAuthPolicy): string {
  const conditions = isSingleResolverCondition(policy.conditions)
    ? [policy.conditions]
    : policy.conditions;
  if (conditions.length === 0) {
    throw new Error("Resolver auth policy must have at least one condition, got an empty array.");
  }
  return conditions.map(resolverPermissionConditionExpr).join(" && ");
}

/**
 * Build the auth guard statement injected at resolver entry.
 *
 * Rejects the call with `TailorErrorMessage` when the caller doesn't match
 * `auth`, evaluated against `context.user` — the original caller, unaffected
 * by `authInvoker`. A `permit: false` policy always denies matching callers.
 * With no `permit: true` policy, `auth` is a pure blocklist (everyone else is
 * allowed); with at least one, it's an allow-list (deny by default, granted
 * only by a matching `permit: true` policy).
 * @param auth - The resolver's `auth` config
 * @returns A JS `if (...) throw ...;` statement, or `undefined` when `auth` is omitted or `"public"`
 */
export function buildResolverAuthGuardExpr(auth: Resolver["auth"]): string | undefined {
  if (!auth || auth === "public") {
    return undefined;
  }
  if (auth.length === 0) {
    throw new Error("Resolver auth must have at least one policy, got an empty array.");
  }
  const denyPolicies = auth.filter((policy) => policy.permit === false);
  const allowPolicies = auth.filter((policy) => policy.permit !== false);

  const deniedExpr =
    denyPolicies.length > 0
      ? denyPolicies.map((policy) => `(${resolverPermissionPolicyExpr(policy)})`).join(" || ")
      : "false";

  // With no allow policies, `auth` is a pure blocklist: deny only callers matching
  // a deny policy, allow everyone else. With at least one allow policy, `auth` is
  // an allow-list: deny anyone that doesn't match an allow policy (in addition to
  // the deny-policy override above).
  const denyExpr =
    allowPolicies.length > 0
      ? `(${deniedExpr}) || !(${allowPolicies.map((policy) => `(${resolverPermissionPolicyExpr(policy)})`).join(" || ")})`
      : deniedExpr;
  const descriptions = auth.map((policy) => policy.description).filter((d) => !!d);
  const message =
    descriptions.length > 0 ? `access denied: ${descriptions.join("; ")}` : "access denied";
  return `if (${denyExpr}) { throw new TailorErrorMessage(${JSON.stringify(message)}); }`;
}
