import type { InferredAttributeMap } from "../../types";
import type { ValueOperand } from "../auth";

export interface Permissions {
  record?: StandardTailorTypePermission;
  gql?: StandardTailorTypeGqlPermission;
}

export type TailorTypePermission<
  User extends object = InferredAttributeMap,
  Type extends object = object,
> = {
  create: readonly ActionPermission<"record", User, Type, false>[];
  read: readonly ActionPermission<"record", User, Type, false>[];
  update: readonly ActionPermission<"record", User, Type, true>[];
  delete: readonly ActionPermission<"record", User, Type, false>[];
};

export type StandardTailorTypePermission = {
  create: readonly StandardActionPermission<"record", false>[];
  read: readonly StandardActionPermission<"record", false>[];
  update: readonly StandardActionPermission<"record", true>[];
  delete: readonly StandardActionPermission<"record", false>[];
};

type ActionPermission<
  Level extends "record" | "gql" = "record" | "gql",
  User extends object = InferredAttributeMap,
  Type extends object = object,
  Update extends boolean = boolean,
> =
  | {
      conditions:
        | PermissionCondition<Level, User, Update, Type>
        | readonly PermissionCondition<Level, User, Update, Type>[];
      description?: string | undefined;
      permit?: boolean;
    }
  | readonly [
      ...PermissionCondition<Level, User, Update, Type>,
      ...([] | [boolean]),
    ] // single array condition
  | readonly [
      ...PermissionCondition<Level, User, Update, Type>[],
      ...([] | [boolean]),
    ]; // multiple array condition

export type StandardActionPermission<
  Level extends "record" | "gql" = "record" | "gql",
  Update extends boolean = boolean,
> = {
  conditions: readonly StandardPermissionCondition<Level, Update>[];
  description?: string;
  permit: "allow" | "deny";
};

export type TailorTypeGqlPermission<
  User extends object = InferredAttributeMap,
  Type extends object = object,
> = readonly GqlPermissionPolicy<User, Type>[];

export type StandardTailorTypeGqlPermission =
  readonly StandardGqlPermissionPolicy[];

type GqlPermissionPolicy<
  User extends object = InferredAttributeMap,
  Type extends object = object,
> = {
  conditions: readonly PermissionCondition<"gql", User, boolean, Type>[];
  actions: "all" | readonly GqlPermissionAction[];
  permit?: boolean;
  description?: string;
};

export type StandardGqlPermissionPolicy = {
  conditions: readonly StandardPermissionCondition<"gql">[];
  actions: readonly ["all"] | readonly GqlPermissionAction[];
  permit: "allow" | "deny";
  description?: string;
};

type GqlPermissionAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "aggregate"
  | "bulkUpsert";

export type PermissionCondition<
  Level extends "record" | "gql" = "record" | "gql",
  User extends object = InferredAttributeMap,
  Update extends boolean = boolean,
  Type extends object = object,
> = readonly [
  PermissionOperand<Level, User, Type, Update>,
  PermissionOperator,
  PermissionOperand<Level, User, Type, Update>,
];

export type StandardPermissionCondition<
  Level extends "record" | "gql" = "record" | "gql",
  Update extends boolean = boolean,
> = readonly [
  PermissionOperand<
    Level,
    Record<string, unknown>,
    Record<string, unknown>,
    Update
  >,
  StandardPermissionOperator,
  PermissionOperand<
    Level,
    Record<string, unknown>,
    Record<string, unknown>,
    Update
  >,
];

type UserOperand<User extends object = InferredAttributeMap> = {
  user:
    | {
        [K in keyof User]: User[K] extends
          | string
          | string[]
          | boolean
          | boolean[]
          ? K
          : never;
      }[keyof User]
    | "id"
    | "_loggedIn";
};

type RecordOperand<
  Type extends object,
  Update extends boolean = false,
> = Update extends true
  ?
      | { oldRecord: (keyof Type & string) | "id" }
      | { newRecord: (keyof Type & string) | "id" }
  : { record: (keyof Type & string) | "id" };

export type PermissionOperand<
  Level extends "record" | "gql" = "record" | "gql",
  User extends object = InferredAttributeMap,
  Type extends object = object,
  Update extends boolean = boolean,
> =
  | UserOperand<User>
  | ValueOperand
  | (Level extends "record" ? RecordOperand<Type, Update> : never);

type PermissionOperator = "=" | "!=" | "in" | "not in";
const operatorMap = {
  "=": "eq",
  "!=": "ne",
  in: "in",
  "not in": "nin",
} as const satisfies Record<PermissionOperator, string>;
type StandardPermissionOperator =
  (typeof operatorMap)[keyof typeof operatorMap];

function normalizeOperand<T extends PermissionOperand<any, any, any, any>>(
  operand: T,
): T {
  if (typeof operand === "object" && "user" in operand) {
    return { user: { id: "_id" }[operand.user] ?? operand.user } as T;
  }
  return operand;
}

function normalizeConditions<
  Level extends "record" | "gql" = "record" | "gql",
  Update extends boolean = boolean,
>(
  conditions: readonly PermissionCondition<Level, any, Update, any>[],
): StandardPermissionCondition<Level, Update>[] {
  return conditions.map((cond) => {
    const [left, operator, right] = cond;
    return [
      normalizeOperand(left),
      operatorMap[operator],
      normalizeOperand(right),
    ];
  }) as StandardPermissionCondition<Level, Update>[];
}

function isObjectFormat(
  p: ActionPermission,
): p is Extract<ActionPermission, { permit?: boolean }> {
  return typeof p === "object" && p !== null && "conditions" in p;
}

function isSingleArrayConditionFormat(
  cond: Exclude<ActionPermission, { permit?: boolean }>,
): cond is PermissionCondition {
  return cond.length >= 2 && typeof cond[1] === "string"; // Check if middle element is an operator
}

export function normalizePermission<
  User extends object = object,
  Type extends object = object,
>(permission: TailorTypePermission<User, Type>): StandardTailorTypePermission {
  return Object.keys(permission).reduce((acc, action) => {
    (acc as any)[action] = (permission as any)[action].map((p: any) =>
      normalizeActionPermission(p),
    );
    return acc;
  }, {}) as StandardTailorTypePermission;
}

export function normalizeGqlPermission<
  const P extends TailorTypeGqlPermission<any>,
>(permission: P): StandardTailorTypeGqlPermission {
  return permission.map((policy) =>
    normalizeGqlPolicy(policy),
  ) as StandardTailorTypeGqlPermission;
}

function normalizeGqlPolicy(
  policy: GqlPermissionPolicy<any, any>,
): StandardGqlPermissionPolicy {
  return {
    conditions: policy.conditions ? normalizeConditions(policy.conditions) : [],
    actions: policy.actions === "all" ? ["all"] : policy.actions,
    permit: policy.permit ? "allow" : "deny",
    description: policy.description,
  };
}
export function normalizeActionPermission(
  permission: ActionPermission,
): StandardActionPermission {
  // object format
  if (isObjectFormat(permission)) {
    return {
      conditions: normalizeConditions(
        isSingleArrayConditionFormat(permission.conditions)
          ? [permission.conditions]
          : permission.conditions,
      ),
      permit: permission.permit ? "allow" : "deny",
      description: permission.description,
    };
  }

  if (isSingleArrayConditionFormat(permission)) {
    const [op1, operator, op2, permit] = [...permission, true];
    return {
      conditions: normalizeConditions([[op1, operator, op2]]),
      permit: permit ? "allow" : "deny",
    };
  }

  // Array of conditions format
  const conditions: PermissionCondition[] = [];
  const conditionArray = permission;
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
 * Grants full record-level access without any conditions.
 *
 * Unsafe and intended only for local development, prototyping, or tests.
 * Do not use this in production environments, as it effectively disables
 * authorization checks.
 */
export const unsafeAllowAllTypePermission: TailorTypePermission = {
  create: [{ conditions: [], permit: true }],
  read: [{ conditions: [], permit: true }],
  update: [{ conditions: [], permit: true }],
  delete: [{ conditions: [], permit: true }],
};

/**
 * Grants full GraphQL access (all actions) without any conditions.
 *
 * Unsafe and intended only for local development, prototyping, or tests.
 * Do not use this in production environments, as it effectively disables
 * authorization checks.
 */
export const unsafeAllowAllGqlPermission: TailorTypeGqlPermission = [
  { conditions: [], actions: "all", permit: true },
];
