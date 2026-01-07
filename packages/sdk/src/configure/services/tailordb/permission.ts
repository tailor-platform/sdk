import type { InferredAttributeMap } from "../../types";
import type { ValueOperand } from "../auth";

export type TailorTypePermission<
  User extends object = InferredAttributeMap,
  Type extends object = object,
> = {
  create: readonly ActionPermission<"record", User, Type, false>[];
  read: readonly ActionPermission<"record", User, Type, false>[];
  update: readonly ActionPermission<"record", User, Type, true>[];
  delete: readonly ActionPermission<"record", User, Type, false>[];
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
  | readonly [...PermissionCondition<Level, User, Update, Type>, ...([] | [boolean])] // single array condition
  | readonly [...PermissionCondition<Level, User, Update, Type>[], ...([] | [boolean])]; // multiple array condition

export type TailorTypeGqlPermission<
  User extends object = InferredAttributeMap,
  Type extends object = object,
> = readonly GqlPermissionPolicy<User, Type>[];

type GqlPermissionPolicy<
  User extends object = InferredAttributeMap,
  Type extends object = object,
> = {
  conditions: readonly PermissionCondition<"gql", User, boolean, Type>[];
  actions: "all" | readonly GqlPermissionAction[];
  permit?: boolean;
  description?: string;
};

type GqlPermissionAction = "read" | "create" | "update" | "delete" | "aggregate" | "bulkUpsert";

export type PermissionCondition<
  Level extends "record" | "gql" = "record",
  User extends object = InferredAttributeMap,
  Update extends boolean = boolean,
  Type extends object = object,
> =
  | PermissionEqCondition<Level, User, Update, Type>
  | PermissionInCondition<Level, User, Update, Type>;

type PermissionEqCondition<
  Level extends "record" | "gql",
  User extends object,
  Update extends boolean,
  Type extends object,
> =
  PermissionLhsOperand<Level, User, Type, Update> extends infer Lhs
    ? // Used only as a condition
      // oxlint-disable-next-line no-explicit-any
      Lhs extends any
      ? readonly [Lhs, EqPermissionOperator, EqPermissionRhs<Level, User, Type, Update, Lhs>]
      : never
    : never;

type PermissionInCondition<
  Level extends "record" | "gql",
  User extends object,
  Update extends boolean,
  Type extends object,
> =
  PermissionLhsOperand<Level, User, Type, Update> extends infer Lhs
    ? // Used only as a condition
      // oxlint-disable-next-line no-explicit-any
      Lhs extends any
      ? readonly [Lhs, InPermissionOperator, InPermissionRhs<Level, Lhs>]
      : never
    : never;

type PermissionLhsOperand<
  Level extends "record" | "gql",
  User extends object,
  Type extends object,
  Update extends boolean,
> = Exclude<PermissionOperand<Level, User, Type, Update>, readonly unknown[]>;

type EqPermissionRhs<
  Level extends "record" | "gql",
  User extends object,
  Type extends object,
  Update extends boolean,
  Lhs,
> = Lhs extends boolean
  ? boolean
  : Lhs extends string
    ? Level extends "gql"
      ? string | boolean
      : string
    : Exclude<PermissionOperand<Level, User, Type, Update>, readonly unknown[]>;

type InPermissionRhs<Level extends "record" | "gql", Lhs> = Lhs extends boolean
  ? readonly boolean[]
  : Lhs extends string
    ? Level extends "gql"
      ? readonly (string | boolean)[]
      : readonly string[]
    : readonly (string | boolean)[];

type UserOperand<User extends object = InferredAttributeMap> = {
  user:
    | {
        [K in keyof User]: User[K] extends string | string[] | boolean | boolean[] ? K : never;
      }[keyof User]
    | "id"
    | "_loggedIn";
};

type RecordOperand<Type extends object, Update extends boolean = false> = Update extends true
  ? { oldRecord: (keyof Type & string) | "id" } | { newRecord: (keyof Type & string) | "id" }
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

type EqPermissionOperator = "=" | "!=";
type InPermissionOperator = "in" | "not in";

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
