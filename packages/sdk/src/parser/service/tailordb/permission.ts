import type {
  StandardTailorTypePermission,
  StandardTailorTypeGqlPermission,
  StandardActionPermission,
  StandardPermissionCondition,
  StandardGqlPermissionPolicy,
  Permissions,
} from "@/parser/service/tailordb/types";
import type { RawPermissions } from "@/types/tailordb.generated";

// Raw permission types for normalize function parameters
type PermissionOperator = "=" | "!=" | "in" | "not in" | "hasAny" | "not hasAny";

type ObjectOperand =
  | { user: string }
  | { record: string }
  | { oldRecord: string }
  | { newRecord: string }
  | { value: unknown };

type ValueOperand = string | boolean | string[] | boolean[];

// GQL string reference pattern (e.g., "user.id", "user.roles")
type GqlStringRef = `user.${string}`;

type PermissionOperand = ObjectOperand | ValueOperand | GqlStringRef;

type PermissionCondition = readonly [PermissionOperand, PermissionOperator, PermissionOperand];

const operatorMap: Record<PermissionOperator, string> = {
  "=": "eq",
  "!=": "ne",
  in: "in",
  "not in": "nin",
  hasAny: "hasAny",
  "not hasAny": "nhasAny",
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

/**
 * Normalize record-level permissions into a standard structure.
 * @param permission - Tailor type permission
 * @returns Normalized record permissions
 */
function normalizePermission(
  permission: NonNullable<RawPermissions["record"]>,
): StandardTailorTypePermission {
  const keys = Object.keys(permission) as Array<keyof typeof permission>;
  return keys.reduce((acc, action) => {
    acc[action] = permission[action].map((p) => normalizeActionPermission(p));
    return acc;
    // oxlint-disable-next-line no-explicit-any
  }, {} as any);
}

/**
 * Normalize GraphQL permissions into a standard structure.
 * @param permission - Tailor GQL permission
 * @returns Normalized GQL permissions
 */
export function normalizeGqlPermission(
  permission: NonNullable<RawPermissions["gql"]>,
): StandardTailorTypeGqlPermission {
  return (permission as readonly GqlPermissionPolicy[]).map((policy) =>
    normalizeGqlPolicy(policy),
  ) as StandardTailorTypeGqlPermission;
}

function normalizeGqlPolicy(policy: GqlPermissionPolicy): StandardGqlPermissionPolicy {
  return {
    conditions: normalizeConditions(policy.conditions),
    actions: policy.actions === "all" ? ["all"] : policy.actions,
    permit: policy.permit ? "allow" : "deny",
    description: policy.description,
  } as StandardGqlPermissionPolicy;
}

/**
 * Parse raw permissions into normalized permissions.
 * This is the main entry point for permission parsing in the parser layer.
 * @param rawPermissions - Raw permissions definition
 * @returns Normalized permissions
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

/**
 * Normalize a single action permission into the standard format.
 * @param permission - Raw permission definition
 * @returns Normalized action permission
 */
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

/**
 * Find object-format permission rules that omit `permit`.
 *
 * Object-format rules default to `deny` when `permit` is omitted, whereas the
 * array shorthand defaults to `allow`. Omitting `permit` on an object rule is
 * therefore an easy way to accidentally deny access you meant to grant, so the
 * CLI warns about these locations to nudge authors toward setting `permit`
 * explicitly.
 * @param rawPermissions - Raw permissions definition
 * @returns Dotted locations of offending rules, e.g. `record.read[0]`, `gql[1]`
 */
export function findOmittedPermitRules(rawPermissions: RawPermissions): string[] {
  const locations: string[] = [];

  const record = rawPermissions.record;
  if (record) {
    for (const action of Object.keys(record) as Array<keyof typeof record>) {
      record[action].forEach((rule: unknown, index: number) => {
        if (isObjectFormat(rule) && rule.permit === undefined) {
          locations.push(`record.${String(action)}[${index}]`);
        }
      });
    }
  }

  // GQL policies are always object form, so no isObjectFormat guard is needed.
  const gql = rawPermissions.gql;
  if (gql) {
    (gql as readonly GqlPermissionPolicy[]).forEach((policy, index) => {
      if (policy.permit === undefined) {
        locations.push(`gql[${index}]`);
      }
    });
  }

  return locations;
}
