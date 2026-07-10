import type { InferredAttributeMap } from "#/runtime/types";

type EqualityOperator = "=" | "!=";

type StringFieldKeys<User extends object> = {
  [K in keyof User]: User[K] extends string ? K : never;
}[keyof User];

type BooleanFieldKeys<User extends object> = {
  [K in keyof User]: User[K] extends boolean ? K : never;
}[keyof User];

type UserStringOperand<User extends object = InferredAttributeMap> = {
  user: StringFieldKeys<User> | "id";
};

type UserBooleanOperand<User extends object = InferredAttributeMap> = {
  user: BooleanFieldKeys<User> | "_loggedIn";
};

type StringEqualityCondition<User extends object> =
  | readonly [UserStringOperand<User>, EqualityOperator, string]
  | readonly [string, EqualityOperator, UserStringOperand<User>];

type BooleanEqualityCondition<User extends object> =
  | readonly [UserBooleanOperand<User>, EqualityOperator, boolean]
  | readonly [boolean, EqualityOperator, UserBooleanOperand<User>];

/**
 * A single condition for {@link ResolverPermission}.
 *
 * Only `user` operands are supported (unlike TailorDB's `record`/`newRecord`/
 * `oldRecord` operands) — a resolver has no associated record to compare
 * against. Only equality (`=`/`!=`) is supported for now.
 *
 * The User type is extended by `tailor.d.ts`, which is automatically generated
 * when running `tailor-sdk generate`. Attributes enabled in the config file's
 * `auth.userProfile.attributes` become available as types.
 */
export type ResolverPermissionCondition<User extends object = InferredAttributeMap> =
  | StringEqualityCondition<User>
  | BooleanEqualityCondition<User>;

/**
 * Access requirement for a resolver, evaluated against the original caller
 * (`context.user`) before `body` runs — unaffected by `authInvoker`.
 * @example
 * const auth: ResolverPermission = {
 *   conditions: [[{ user: "_loggedIn" }, "=", true]],
 *   permit: true,
 * };
 */
export type ResolverPermission<User extends object = InferredAttributeMap> = {
  conditions: ResolverPermissionCondition<User> | readonly ResolverPermissionCondition<User>[];
  /** Whether matching callers are granted (`true`) or denied (`false`) access. */
  permit: boolean;
  description?: string;
};
