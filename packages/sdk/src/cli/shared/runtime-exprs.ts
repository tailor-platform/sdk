/**
 * JS expressions that shape the inputs passed to user-authored code.
 *
 * Two delivery paths:
 * - Apply config: shipped with apply and evaluated by the platform before
 *   invoking user code.
 * - Bundle inline: interpolated into the generated entry module and
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

type ResolverPermissionPolicies = Extract<NonNullable<Resolver["permission"]>, readonly unknown[]>;
type ResolverPermissionPolicy = ResolverPermissionPolicies[number];
type ResolverPermissionOperand = string | boolean | { user: string };
type ResolverPermissionCondition = readonly [
  ResolverPermissionOperand,
  "=" | "!=",
  ResolverPermissionOperand,
];

function isSingleResolverCondition(
  conditions: ResolverPermissionPolicy["conditions"],
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

function resolverPermissionPolicyExpr(policy: ResolverPermissionPolicy): string {
  const conditions = isSingleResolverCondition(policy.conditions)
    ? [policy.conditions]
    : policy.conditions;
  if (conditions.length === 0) {
    throw new Error(
      "Resolver permission policy must have at least one condition, got an empty array.",
    );
  }
  return conditions.map(resolverPermissionConditionExpr).join(" && ");
}

/**
 * Build a JS object literal capturing whether `policy` matched and its
 * (possibly empty) description, for runtime denial-reason attribution.
 * @param policy - The policy to compile
 * @returns A JS object literal expression: `{ matched, description }`
 */
function policyEntryExpr(policy: ResolverPermissionPolicy): string {
  return `{ matched: ${resolverPermissionPolicyExpr(policy)}, description: ${JSON.stringify(policy.description ?? "")} }`;
}

/**
 * Build the permission guard statement injected at resolver entry.
 *
 * Rejects the call with `TailorErrorMessage` when the caller doesn't match
 * `permission`, evaluated against `context.user` — the original caller,
 * unaffected by `authInvoker`. A `permit: false` policy always denies matching
 * callers. With no `permit: true` policy, `permission` is a pure blocklist
 * (everyone else is allowed); with at least one, it's an allow-list (deny by
 * default, granted only by a matching `permit: true` policy). The thrown
 * message only includes the description(s) of the policy/policies that
 * actually caused the denial.
 * @param permission - The resolver's `permission` config
 * @returns A JS statement, or `undefined` when `permission` is omitted or `"allowAnonymous"`
 */
export function buildResolverPermissionGuardExpr(
  permission: Resolver["permission"],
): string | undefined {
  if (!permission || permission === "allowAnonymous") {
    return undefined;
  }
  if (permission.length === 0) {
    throw new Error("Resolver permission must have at least one policy, got an empty array.");
  }
  const denyPolicies = permission.filter((policy) => policy.permit === false);
  const allowPolicies = permission.filter((policy) => policy.permit !== false);

  const denyEntriesExpr = `[${denyPolicies.map(policyEntryExpr).join(", ")}]`;
  const allowEntriesExpr = `[${allowPolicies.map(policyEntryExpr).join(", ")}]`;

  return `{
    const $denyPolicies = ${denyEntriesExpr};
    const $allowPolicies = ${allowEntriesExpr};
    const $matchedDeny = $denyPolicies.filter((p) => p.matched);
    const $anyAllowMatched = $allowPolicies.some((p) => p.matched);
    if ($matchedDeny.length > 0 || ($allowPolicies.length > 0 && !$anyAllowMatched)) {
      const $reasons = ($matchedDeny.length > 0 ? $matchedDeny : $allowPolicies)
        .map((p) => p.description)
        .filter(Boolean);
      throw new TailorErrorMessage($reasons.length > 0 ? "access denied: " + $reasons.join("; ") : "access denied");
    }
  }`;
}

/**
 * Build the permission guard and input-validation statements shared by every
 * resolver entry wrapper (production bundling and `function test-run`).
 *
 * Kept as a single generator so a resolver-wrapping behavior (like the
 * permission guard) can't be added to one entry-point template and forgotten
 * in the other. References `context.user`, `context.input`, and
 * `_internalResolver` — the caller's wrapper must bind a `context` object
 * with `user`/`input` properties before inlining this expression.
 * @param permission - The resolver's `permission` config
 * @returns A JS statement block to inline before calling `_internalResolver.body(...)`
 */
export function buildResolverPermissionAndInputCheckExpr(
  permission: Resolver["permission"],
): string {
  const permissionGuardExpr = buildResolverPermissionGuardExpr(permission);
  return `
    ${permissionGuardExpr ?? ""}
    if (_internalResolver.input) {
      const result = t.object(_internalResolver.input).parse({
        value: context.input,
        data: context.input,
        user: context.user,
      });

      if (result.issues) {
        throw new TailorErrors(result.issues.map(issue => ({
          message: issue.message,
          path: issue.path ?? [],
        })));
      }
    }
  `;
}
