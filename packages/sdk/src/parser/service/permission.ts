export type NormalizedPermit = "allow" | "deny";

export interface NormalizedActionPermission<Condition> {
  conditions: Condition[];
  permit: NormalizedPermit;
  description?: string;
}

/**
 * Check whether a permission rule uses the object format (`{ conditions, permit?, description? }`).
 * @param p - A raw permission rule
 * @returns Whether the rule is in object format
 */
export function isObjectPermissionFormat(
  p: unknown,
): p is { conditions: unknown; permit?: boolean; description?: string } {
  return typeof p === "object" && p !== null && "conditions" in p;
}

function isSingleConditionFormat(cond: readonly unknown[]): boolean {
  return cond.length >= 2 && typeof cond[1] === "string"; // Check if middle element is an operator
}

function normalizeOperand(operand: unknown): unknown {
  if (typeof operand === "object" && operand !== null && !Array.isArray(operand)) {
    if ("user" in operand) {
      const user = operand.user;
      return { user: user === "id" ? "_id" : user };
    }
  }
  return operand;
}

/**
 * Build the permission normalizer shared by the services that accept the
 * condition-triple permission formats (object form, single-condition
 * shorthand, and condition-array shorthand).
 *
 * The services differ only in their operator vocabulary and in the type they
 * give the normalized conditions, so both are parameters.
 * @param operatorMap - Service-specific map from source operators to normalized names
 * @returns `normalizeConditions` and `normalizeActionPermission` for the service
 */
export function createPermissionNormalizer<Operator extends string, Condition>(
  operatorMap: Record<Operator, string>,
) {
  type RawCondition = readonly [unknown, Operator, unknown];

  function normalizeConditions(conditions: readonly RawCondition[]): Condition[] {
    return conditions.map((cond) => {
      const [left, operator, right] = cond;
      return [normalizeOperand(left), operatorMap[operator], normalizeOperand(right)];
    }) as Condition[];
  }

  function normalizeActionPermission(permission: unknown): NormalizedActionPermission<Condition> {
    // object format
    if (isObjectPermissionFormat(permission)) {
      const conditions = permission.conditions as RawCondition | readonly RawCondition[];
      return {
        conditions: normalizeConditions(
          isSingleConditionFormat(conditions)
            ? [conditions as RawCondition]
            : (conditions as readonly RawCondition[]),
        ),
        permit: permission.permit ? "allow" : "deny",
        description: permission.description,
      };
    }

    if (!Array.isArray(permission)) {
      throw new Error("Invalid permission format");
    }

    // Single condition shorthand, with an optional trailing permit boolean
    if (isSingleConditionFormat(permission)) {
      const [op1, operator, op2, permit] = [...permission, true] as [
        unknown,
        Operator,
        unknown,
        boolean,
      ];
      return {
        conditions: normalizeConditions([[op1, operator, op2]]),
        permit: permit ? "allow" : "deny",
      };
    }

    // Array of conditions format, with an optional permit boolean among the items
    const conditions: RawCondition[] = [];
    let permit = true;
    for (const item of permission as readonly unknown[]) {
      if (typeof item === "boolean") {
        permit = item;
        continue;
      }
      conditions.push(item as RawCondition);
    }

    return {
      conditions: normalizeConditions(conditions),
      permit: permit ? "allow" : "deny",
    };
  }

  return { normalizeConditions, normalizeActionPermission };
}

/**
 * Whether an object-format rule omits `permit`.
 *
 * Object-format rules default to `deny` when `permit` is omitted, whereas the
 * array shorthand defaults to `allow`. Omitting `permit` on an object rule is
 * therefore an easy way to accidentally deny access you meant to grant, so the
 * CLI warns about such rules to nudge authors toward setting `permit`
 * explicitly.
 * @param rule - A raw permission rule
 * @returns Whether the rule is object-format with `permit` omitted
 */
export function hasOmittedPermit(rule: unknown): boolean {
  return isObjectPermissionFormat(rule) && rule.permit === undefined;
}
