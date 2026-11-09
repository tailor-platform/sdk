type Operand = string | boolean | { user: string } | { input: string };
type Condition = readonly [Operand, "=" | "!=", Operand];
type Conditions = Condition | readonly Condition[];
type Permission = readonly { conditions: Conditions }[] | "allowAnonymous" | undefined;

/**
 * Check whether a resolver permission operand refers to the caller.
 * @param operand - A condition operand
 * @returns Whether it is a `{ user }` operand
 */
export function isUserOperand(operand: Operand): operand is { user: string } {
  return typeof operand === "object" && "user" in operand;
}

/**
 * Check whether a resolver permission operand refers to the resolver's input.
 * @param operand - A condition operand
 * @returns Whether it is an `{ input }` operand
 */
export function isInputOperand(operand: Operand): operand is { input: string } {
  return typeof operand === "object" && "input" in operand;
}

/**
 * Tell a policy's single condition tuple from a list of tuples.
 * @param conditions - A policy's `conditions`
 * @returns Whether `conditions` is one condition tuple
 */
export function isSingleCondition<C extends Condition>(
  conditions: C | readonly C[],
): conditions is C {
  return conditions.length === 3 && typeof conditions[1] === "string";
}

/**
 * Collect the input fields a resolver permission compares with the caller.
 * @param permission - A resolver `permission` or namespace `defaultPermission`
 * @returns Names of the input fields its `{ input }` operands reference
 */
export function permissionInputFields(permission: Permission): Set<string> {
  if (typeof permission !== "object") {
    return new Set();
  }
  return new Set(
    permission.flatMap(({ conditions }) =>
      (isSingleCondition(conditions) ? [conditions] : conditions)
        .flatMap(([left, , right]) => [left, right])
        .flatMap((operand) => (isInputOperand(operand) ? [operand.input] : [])),
    ),
  );
}
