/**
 * JS expressions that shape the inputs passed to user-authored code.
 *
 * Two delivery paths:
 * - Apply config: shipped with apply and evaluated by the platform before
 *   invoking user code.
 * - Bundle inline: interpolated into the generated entry module and
 *   evaluated inside the bundled script at function entry.
 *
 * The principal field mapping (server → SDK) shared across services is built by
 * `makePrincipalExpr` from `@/parser/service/tailordb`; `tailorPrincipalMap`
 * (the `caller` mapping) is one of its outputs. `INVOKER_EXPR` and
 * `ACTOR_TRANSFORM_EXPR` below come from the same factory so the three stay in
 * sync.
 */
import { makePrincipalExpr, tailorPrincipalMap } from "#/parser/service/tailordb/index";
import type { Trigger } from "#/types/executor.generated";
import type { Resolver } from "#/types/resolver.generated";

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

    // Workflow events carry no namespace, and a single trigger can mix events
    // that report an outcome with events that do not, so `success` is derived
    // only when the delivered event actually has a result.
    case "workflowExecution":
    case "workflowJobExecution":
      return `({ ...args, event: args.eventType?.split(".").pop(), rawEvent: args.eventType, ${ACTOR_TRANSFORM_EXPR}, ...(args.succeeded ? { success: true } : args.failed ? { success: false, error: args.failed.error ?? "" } : {}), ${envExpr} })`;

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
      return `(context.caller !== null)`;
    }
    if (operand.user === "id") {
      return `context.caller?.id`;
    }
    return `context.caller?.attributes?.[${JSON.stringify(operand.user)}]`;
  }
  return JSON.stringify(operand);
}

// `_loggedIn` always evaluates to a defined boolean, but `id` and arbitrary
// attribute lookups go through `context.caller?.` and can be `undefined` --
// the caller is `null` for anonymous requests, and an attribute key may not
// be set.
function isArbitraryAttributeOperand(operand: ResolverPermissionOperand): boolean {
  return typeof operand === "object" && operand.user !== "_loggedIn";
}

function resolverPermissionConditionExpr(condition: ResolverPermissionCondition): string {
  const [left, operator, right] = condition;
  const leftExpr = resolverPermissionOperandExpr(left);
  const rightExpr = resolverPermissionOperandExpr(right);

  if (operator === "!=") {
    // A missing attribute must not satisfy `!=` -- otherwise an
    // attribute-less caller would unintentionally match a policy meant to
    // exclude only a specific value (`{ user: "role" } != "BANNED"` should
    // not let a caller with no `role` attribute at all through).
    const userOperandExpr = isArbitraryAttributeOperand(left)
      ? leftExpr
      : isArbitraryAttributeOperand(right)
        ? rightExpr
        : undefined;
    if (userOperandExpr) {
      return `(${userOperandExpr} !== undefined && ${leftExpr} !== ${rightExpr})`;
    }
  }

  const jsOperator = operator === "=" ? "===" : "!==";
  return `(${leftExpr} ${jsOperator} ${rightExpr})`;
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
 * Rejects the call with `TailorErrors` — the only error class the platform
 * turns back into a message the caller can read — when the caller doesn't match
 * `permission`, evaluated against `context.caller` — the original caller,
 * unaffected by `authInvoker`. `permission` is deny-by-default: a caller is
 * granted only by a matching `permit: true` policy, and a matching
 * `permit: false` policy always overrides that grant. The thrown message only
 * includes the description(s) of the policy/policies that actually caused the
 * denial.
 *
 * The schema requires at least one `permit: true` policy (an array of only
 * `permit: false` policies is rejected at build time), so `allowPolicies` is
 * never empty here for schema-valid input; this function still handles that
 * case defensively since it also runs against test-authored raw shapes.
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
      const $message = $reasons.length > 0 ? "access denied: " + $reasons.join("; ") : "access denied";
      throw new TailorErrors([{ message: $message, path: [] }]);
    }
  }`;
}

/**
 * A resolver's permission config together with the default declared by its
 * namespace. The resolver's own `permission` replaces the namespace default
 * instead of merging with it, so a resolver opts out of a namespace-wide
 * requirement with `permission: "allowAnonymous"`.
 */
export type ResolverPermissionResolution = {
  permission: Resolver["permission"];
  defaultPermission?: Resolver["permission"];
};

/**
 * Build the permission guard and input-validation statements shared by every
 * resolver entry wrapper (production bundling and `function run`).
 *
 * Kept as a single generator so a resolver-wrapping behavior (like the
 * permission guard) can't be added to one entry-point template and forgotten
 * in the other — the namespace-default precedence below is resolved here for
 * the same reason. References `context.caller`, `context.input`, `invoker`,
 * and `_internalResolver` — the caller's wrapper must bind a `context` object
 * with `user`/`input` properties and an `invoker` binding (from
 * `INVOKER_EXPR`) before inlining this expression.
 * @param params - The resolver's and its namespace's permission config
 * @returns A JS statement block to inline before calling `_internalResolver.body(...)`
 */
export function buildResolverPermissionAndInputCheckExpr(
  params: ResolverPermissionResolution,
): string {
  const { permission, defaultPermission } = params;
  const permissionGuardExpr = buildResolverPermissionGuardExpr(permission ?? defaultPermission);
  return `
    ${permissionGuardExpr ?? ""}
    if (_internalResolver.input) {
      const result = t.object(_internalResolver.input).parse({
        value: context.input,
        data: context.input,
        invoker,
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
