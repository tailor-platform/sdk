import type { InferredAttributeMap } from "../../types";

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

type EqualityOperator = "=" | "!=";
type ContainsOperator = "in" | "not in";

// Helper types for User field extraction
type StringFieldKeys<User extends object> = {
  [K in keyof User]: User[K] extends string ? K : never;
}[keyof User];

type StringArrayFieldKeys<User extends object> = {
  [K in keyof User]: User[K] extends string[] ? K : never;
}[keyof User];

type BooleanFieldKeys<User extends object> = {
  [K in keyof User]: User[K] extends boolean ? K : never;
}[keyof User];

type BooleanArrayFieldKeys<User extends object> = {
  [K in keyof User]: User[K] extends boolean[] ? K : never;
}[keyof User];

type UserStringOperand<User extends object = InferredAttributeMap> = {
  user: StringFieldKeys<User> | "id";
};

type UserStringArrayOperand<User extends object = InferredAttributeMap> = {
  user: StringArrayFieldKeys<User>;
};

type UserBooleanOperand<User extends object = InferredAttributeMap> = {
  user: BooleanFieldKeys<User> | "_loggedIn";
};

type UserBooleanArrayOperand<User extends object = InferredAttributeMap> = {
  user: BooleanArrayFieldKeys<User>;
};

type RecordOperand<Type extends object, Update extends boolean = false> = Update extends true
  ? { oldRecord: (keyof Type & string) | "id" } | { newRecord: (keyof Type & string) | "id" }
  : { record: (keyof Type & string) | "id" };

type StringEqualityCondition<
  Level extends "record" | "gql",
  User extends object,
  Update extends boolean,
  Type extends object,
> =
  | (Level extends "gql" ? readonly [string, EqualityOperator, boolean] : never)
  | readonly [string, EqualityOperator, string]
  | readonly [UserStringOperand<User>, EqualityOperator, string]
  | readonly [string, EqualityOperator, UserStringOperand<User>]
  | (Level extends "record"
      ?
          | readonly [
              RecordOperand<Type, Update>,
              EqualityOperator,
              string | UserStringOperand<User>,
            ]
          | readonly [
              string | UserStringOperand<User>,
              EqualityOperator,
              RecordOperand<Type, Update>,
            ]
      : never);

type BooleanEqualityCondition<
  Level extends "record" | "gql",
  User extends object,
  Update extends boolean,
  Type extends object,
> =
  | readonly [boolean, EqualityOperator, boolean]
  | readonly [UserBooleanOperand<User>, EqualityOperator, boolean]
  | readonly [boolean, EqualityOperator, UserBooleanOperand<User>]
  | (Level extends "record"
      ?
          | readonly [
              RecordOperand<Type, Update>,
              EqualityOperator,
              boolean | UserBooleanOperand<User>,
            ]
          | readonly [
              boolean | UserBooleanOperand<User>,
              EqualityOperator,
              RecordOperand<Type, Update>,
            ]
      : never);

type EqualityCondition<
  Level extends "record" | "gql" = "record",
  User extends object = InferredAttributeMap,
  Update extends boolean = boolean,
  Type extends object = object,
> =
  | StringEqualityCondition<Level, User, Update, Type>
  | BooleanEqualityCondition<Level, User, Update, Type>;

type StringContainsCondition<
  Level extends "record" | "gql",
  User extends object,
  Update extends boolean,
  Type extends object,
> =
  | readonly [string, ContainsOperator, string[]]
  | readonly [UserStringOperand<User>, ContainsOperator, string[]]
  | readonly [string, ContainsOperator, UserStringArrayOperand<User>]
  | (Level extends "record"
      ?
          | readonly [
              RecordOperand<Type, Update>,
              ContainsOperator,
              string[] | UserStringArrayOperand<User>,
            ]
          | readonly [
              string | UserStringOperand<User>,
              ContainsOperator,
              RecordOperand<Type, Update>,
            ]
      : never);

type BooleanContainsCondition<
  Level extends "record" | "gql",
  User extends object,
  Update extends boolean,
  Type extends object,
> =
  | (Level extends "gql" ? readonly [string, ContainsOperator, boolean[]] : never)
  | readonly [boolean, ContainsOperator, boolean[]]
  | readonly [UserBooleanOperand<User>, ContainsOperator, boolean[]]
  | readonly [boolean, ContainsOperator, UserBooleanArrayOperand<User>]
  | (Level extends "record"
      ?
          | readonly [
              RecordOperand<Type, Update>,
              ContainsOperator,
              boolean[] | UserBooleanArrayOperand<User>,
            ]
          | readonly [
              boolean | UserBooleanOperand<User>,
              ContainsOperator,
              RecordOperand<Type, Update>,
            ]
      : never);

type ContainsCondition<
  Level extends "record" | "gql" = "record",
  User extends object = InferredAttributeMap,
  Update extends boolean = boolean,
  Type extends object = object,
> =
  | StringContainsCondition<Level, User, Update, Type>
  | BooleanContainsCondition<Level, User, Update, Type>;

/**
 * Type representing a permission condition that combines user attributes, record fields, and literal values using comparison operators.
 *
 * The User type is extended by `user-defined.d.ts`, which is automatically generated when running `tailor-sdk generate`.
 * Attributes enabled in the config file's `auth.userProfile.attributes` become available as types.
 * @example
 * ```ts
 * // tailor.config.ts
 * export const auth = defineAuth("my-auth", {
 *   userProfile: {
 *     type: user,
 *     attributes: {
 *       isAdmin: true,
 *       roles: true,
 *     }
 *   }
 * });
 * ```
 */
export type PermissionCondition<
  Level extends "record" | "gql" = "record",
  User extends object = InferredAttributeMap,
  Update extends boolean = boolean,
  Type extends object = object,
> = EqualityCondition<Level, User, Update, Type> | ContainsCondition<Level, User, Update, Type>;

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
