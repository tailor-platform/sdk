import type {
  TailorTypePermission,
  TailorTypeGqlPermission,
  StandardTailorTypePermission,
  StandardTailorTypeGqlPermission,
  StandardActionPermission,
  StandardPermissionCondition,
  StandardGqlPermissionPolicy,
  RawPermissions,
  Permissions,
} from "./types";

// Raw permission types for normalize function parameters
type PermissionOperator = "=" | "!=" | "in" | "not in";

type PermissionOperand =
  | { user: string }
  | { record: string }
  | { oldRecord: string }
  | { newRecord: string }
  | { value: unknown };

type PermissionCondition = readonly [PermissionOperand, PermissionOperator, PermissionOperand];

const operatorMap: Record<PermissionOperator, string> = {
  "=": "eq",
  "!=": "ne",
  in: "in",
  "not in": "nin",
};

type GqlPermissionPolicy = {
  conditions: readonly PermissionCondition[];
  actions: "all" | readonly GqlPermissionAction[];
  permit?: boolean;
  description?: string;
};

type GqlPermissionAction = "read" | "create" | "update" | "delete" | "aggregate" | "bulkUpsert";

function normalizeOperand(operand: PermissionOperand): PermissionOperand {
  if (typeof operand === "object" && "user" in operand) {
    const mapped = operand.user === "id" ? "_id" : operand.user;
    return { user: mapped };
  }
  return operand;
}

function normalizeConditions(
  conditions: readonly PermissionCondition[],
): StandardPermissionCondition[] {
  return conditions.map((cond) => {
    const [left, operator, right] = cond;
    return [normalizeOperand(left), operatorMap[operator], normalizeOperand(right)];
  }) as StandardPermissionCondition[];
}

function isObjectFormat(
  p: unknown,
): p is { conditions: unknown; permit?: boolean; description?: string } {
  return typeof p === "object" && p !== null && "conditions" in p;
}

function isSingleArrayConditionFormat(cond: readonly unknown[]): boolean {
  return cond.length >= 2 && typeof cond[1] === "string"; // Check if middle element is an operator
}

export function normalizePermission<User extends object = object, Type extends object = object>(
  permission: TailorTypePermission<User, Type>,
): StandardTailorTypePermission {
  const keys = Object.keys(permission) as Array<keyof typeof permission>;
  return keys.reduce((acc, action) => {
    acc[action] = permission[action].map((p) => normalizeActionPermission(p));
    return acc;
  }, {} as StandardTailorTypePermission);
}

export function normalizeGqlPermission(
  // Raw GQL permissions are not strongly typed at parse time
  // oxlint-disable-next-line no-explicit-any
  permission: TailorTypeGqlPermission<any, any>,
): StandardTailorTypeGqlPermission {
  return (permission as readonly GqlPermissionPolicy[]).map((policy) =>
    normalizeGqlPolicy(policy),
  ) as StandardTailorTypeGqlPermission;
}

function normalizeGqlPolicy(policy: GqlPermissionPolicy): StandardGqlPermissionPolicy {
  return {
    conditions: policy.conditions ? normalizeConditions(policy.conditions) : [],
    actions: policy.actions === "all" ? ["all"] : policy.actions,
    permit: policy.permit ? "allow" : "deny",
    description: policy.description,
  } as StandardGqlPermissionPolicy;
}

/**
 * Parse raw permissions into normalized permissions.
 * This is the main entry point for permission parsing in the parser layer.
 */
export function parsePermissions(rawPermissions: RawPermissions): Permissions {
  return {
    ...(rawPermissions.record && {
      record: normalizePermission(rawPermissions.record),
    }),
    ...(rawPermissions.gql && {
      gql: normalizeGqlPermission(rawPermissions.gql),
    }),
  };
}

export function normalizeActionPermission(permission: unknown): StandardActionPermission {
  // object format
  if (isObjectFormat(permission)) {
    const conditions = permission.conditions as
      | PermissionCondition
      | readonly PermissionCondition[];
    return {
      conditions: normalizeConditions(
        isSingleArrayConditionFormat(conditions)
          ? [conditions as PermissionCondition]
          : (conditions as readonly PermissionCondition[]),
      ),
      permit: permission.permit ? "allow" : "deny",
      description: permission.description,
    };
  }

  if (!Array.isArray(permission)) {
    throw new Error("Invalid permission format");
  }

  if (isSingleArrayConditionFormat(permission)) {
    const [op1, operator, op2, permit] = [...permission, true] as [
      PermissionOperand,
      string,
      PermissionOperand,
      boolean,
    ];
    return {
      conditions: normalizeConditions([[op1, operator, op2] as PermissionCondition]),
      permit: permit ? "allow" : "deny",
    };
  }

  // Array of conditions format
  const conditions: PermissionCondition[] = [];
  const conditionArray = permission as readonly unknown[];
  let conditionArrayPermit = true;

  for (const item of conditionArray) {
    if (typeof item === "boolean") {
      conditionArrayPermit = item;
      continue;
    }
    conditions.push(item as PermissionCondition);
  }

  return {
    conditions: normalizeConditions(conditions),
    permit: conditionArrayPermit ? "allow" : "deny",
  };
}
