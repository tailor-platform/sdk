import type { Resolver } from "#/types/resolver.generated";
import type { z } from "zod";

export type ResolverPermissionPolicy = Extract<
  NonNullable<Resolver["permission"]>,
  readonly unknown[]
>[number];
export type ResolverPermissionCondition = Extract<
  ResolverPermissionPolicy["conditions"],
  readonly [unknown, unknown, unknown]
>;
export type ResolverPermissionOperand = ResolverPermissionCondition[0];

/**
 * Check whether a resolver permission operand refers to the caller.
 * @param operand - A condition operand
 * @returns Whether it is a `{ user }` operand
 */
export function isUserOperand(
  operand: ResolverPermissionOperand,
): operand is Extract<ResolverPermissionOperand, { user: unknown }> {
  return typeof operand === "object" && "user" in operand;
}

/**
 * Check whether a resolver permission operand refers to the resolver's input.
 * @param operand - A condition operand
 * @returns Whether it is an `{ input }` operand
 */
export function isInputOperand(
  operand: ResolverPermissionOperand,
): operand is Extract<ResolverPermissionOperand, { input: unknown }> {
  return typeof operand === "object" && "input" in operand;
}

/**
 * Tell a policy's single condition tuple from a list of tuples.
 * @param conditions - A policy's `conditions`
 * @returns Whether `conditions` is one condition tuple
 */
export function isSingleCondition<C extends ResolverPermissionCondition>(
  conditions: C | readonly C[],
): conditions is C {
  return conditions.length === 3 && typeof conditions[1] === "string";
}

type IndexedCondition<C extends ResolverPermissionCondition> = {
  condition: C;
  path: (string | number)[];
};

/**
 * List a policy's condition tuples with their path under the policy.
 * @param conditions - A policy's `conditions`
 * @returns Each condition tuple and its path
 */
export function indexedConditions<C extends ResolverPermissionCondition>(
  conditions: C | readonly C[],
): IndexedCondition<C>[] {
  return isSingleCondition(conditions)
    ? [{ condition: conditions, path: ["conditions"] }]
    : conditions.map((condition, index) => ({ condition, path: ["conditions", index] }));
}

type InputOperandReference = {
  field: string;
  path: (string | number)[];
};

function inputOperandReferences(permission: Resolver["permission"]): InputOperandReference[] {
  if (typeof permission !== "object") {
    return [];
  }
  return permission.flatMap((policy, policyIndex) =>
    indexedConditions(policy.conditions).flatMap(({ condition, path }) =>
      ([0, 2] as const).flatMap((side) => {
        const operand = condition[side];
        return isInputOperand(operand)
          ? [{ field: operand.input, path: [policyIndex, ...path, side] }]
          : [];
      }),
    ),
  );
}

const COMPARABLE_INPUT_FIELD_TYPES = new Set<string>(["string", "uuid", "enum"]);

/**
 * Report each `{ input }` operand in a resolver's `permission` that names an
 * input field the resolver does not declare or cannot compare.
 * @param resolver - The resolver's `input` and `permission`
 * @param ctx - Refinement context the issues are added to
 */
export function checkPermissionInputs(
  resolver: Pick<Resolver, "input" | "permission">,
  ctx: z.RefinementCtx,
): void {
  const input = resolver.input ?? {};
  for (const reference of inputOperandReferences(resolver.permission)) {
    const path = ["permission", ...reference.path];
    const field = Object.hasOwn(input, reference.field) ? input[reference.field] : undefined;
    if (field === undefined) {
      ctx.addIssue({
        code: "custom",
        path,
        message: `\`permission\` references input field \`${reference.field}\`, which \`input\` does not declare`,
      });
    } else if (!COMPARABLE_INPUT_FIELD_TYPES.has(field.type) || field.metadata.array) {
      ctx.addIssue({
        code: "custom",
        path,
        message: `\`permission\` compares input field \`${reference.field}\`, but only a string, uuid, or enum field that is not an array can be compared`,
      });
    }
  }
}

/**
 * Report each `{ input }` operand in a resolver namespace's `defaultPermission`.
 * @param defaultPermission - The namespace's `defaultPermission`
 * @param ctx - Refinement context the issues are added to
 */
export function checkDefaultPermissionInputs(
  defaultPermission: Resolver["permission"],
  ctx: z.RefinementCtx,
): void {
  for (const { path } of inputOperandReferences(defaultPermission)) {
    ctx.addIssue({
      code: "custom",
      path,
      message:
        "`defaultPermission` cannot use an `input` operand, since a namespace has no input; " +
        "declare it in each resolver's own `permission`",
    });
  }
}
