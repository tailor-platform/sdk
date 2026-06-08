import type { IdPUserField } from "@/types/idp";
import type { InferredAttributeMap } from "@/types/user";

type EqualityOperator = "=" | "!=";
type ContainsOperator = "in" | "not in";

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

type IdPUserOperand<Update extends boolean = false> = Update extends true
  ? { oldIdpUser: IdPUserField } | { newIdpUser: IdPUserField }
  : { idpUser: IdPUserField };

type StringEqualityCondition<User extends object, Update extends boolean> =
  | readonly [string, EqualityOperator, string]
  | readonly [UserStringOperand<User>, EqualityOperator, string]
  | readonly [string, EqualityOperator, UserStringOperand<User>]
  | readonly [
      IdPUserOperand<Update>,
      EqualityOperator,
      string | UserStringOperand<User> | IdPUserOperand<Update>,
    ]
  | readonly [string | UserStringOperand<User>, EqualityOperator, IdPUserOperand<Update>];

type BooleanEqualityCondition<User extends object, Update extends boolean> =
  | readonly [boolean, EqualityOperator, boolean]
  | readonly [UserBooleanOperand<User>, EqualityOperator, boolean]
  | readonly [boolean, EqualityOperator, UserBooleanOperand<User>]
  | readonly [
      IdPUserOperand<Update>,
      EqualityOperator,
      boolean | UserBooleanOperand<User> | IdPUserOperand<Update>,
    ]
  | readonly [boolean | UserBooleanOperand<User>, EqualityOperator, IdPUserOperand<Update>];

type EqualityCondition<
  User extends object = InferredAttributeMap,
  Update extends boolean = boolean,
> = StringEqualityCondition<User, Update> | BooleanEqualityCondition<User, Update>;

type StringContainsCondition<User extends object, Update extends boolean> =
  | readonly [string, ContainsOperator, string[]]
  | readonly [UserStringOperand<User>, ContainsOperator, string[]]
  | readonly [string, ContainsOperator, UserStringArrayOperand<User>]
  | readonly [IdPUserOperand<Update>, ContainsOperator, string[] | UserStringArrayOperand<User>];

type BooleanContainsCondition<User extends object, Update extends boolean> =
  | readonly [boolean, ContainsOperator, boolean[]]
  | readonly [UserBooleanOperand<User>, ContainsOperator, boolean[]]
  | readonly [boolean, ContainsOperator, UserBooleanArrayOperand<User>]
  | readonly [IdPUserOperand<Update>, ContainsOperator, boolean[] | UserBooleanArrayOperand<User>];

type ContainsCondition<
  User extends object = InferredAttributeMap,
  Update extends boolean = boolean,
> = StringContainsCondition<User, Update> | BooleanContainsCondition<User, Update>;

export type IdPPermissionCondition<
  User extends object = InferredAttributeMap,
  Update extends boolean = boolean,
> = EqualityCondition<User, Update> | ContainsCondition<User, Update>;

type IdPActionPermission<
  User extends object = InferredAttributeMap,
  Update extends boolean = boolean,
> =
  | {
      conditions:
        | IdPPermissionCondition<User, Update>
        | readonly IdPPermissionCondition<User, Update>[];
      description?: string | undefined;
      /**
       * Whether matching users are granted (`true`) or denied (`false`).
       * Omitting `permit` in this object form defaults to `deny` and emits a
       * warning; set it explicitly. (The array shorthand defaults to `allow`.)
       */
      permit?: boolean;
    }
  | readonly [...IdPPermissionCondition<User, Update>, ...([] | [boolean])]
  | readonly [...IdPPermissionCondition<User, Update>[], ...([] | [boolean])];

/**
 * Per-operation permission policies for an IdP service.
 * Defines create, read, update, delete, and sendPasswordResetEmail permissions.
 *
 * For update operations, use `newIdpUser`/`oldIdpUser` operands instead of `idpUser`.
 * @example
 * const permission: IdPPermission = {
 *   create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
 *   read: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
 *   update: [{ conditions: [[{ newIdpUser: "name" }, "=", { user: "id" }]], permit: true }],
 *   delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
 *   sendPasswordResetEmail: [{ conditions: [], permit: true }],
 * };
 */
export type IdPPermission<User extends object = InferredAttributeMap> = {
  create: readonly IdPActionPermission<User, false>[];
  read: readonly IdPActionPermission<User, false>[];
  update: readonly IdPActionPermission<User, true>[];
  delete: readonly IdPActionPermission<User, false>[];
  sendPasswordResetEmail: readonly IdPActionPermission<User, false>[];
};

/**
 * Grants full IdP permission access without any conditions.
 *
 * Unsafe and intended only for local development, prototyping, or tests.
 * Do not use this in production environments, as it effectively disables
 * authorization checks.
 */
export const unsafeAllowAllIdPPermission: IdPPermission = {
  create: [{ conditions: [], permit: true }],
  read: [{ conditions: [], permit: true }],
  update: [{ conditions: [], permit: true }],
  delete: [{ conditions: [], permit: true }],
  sendPasswordResetEmail: [{ conditions: [], permit: true }],
};
