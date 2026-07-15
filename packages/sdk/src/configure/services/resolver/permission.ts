import type {
  UserBooleanOperand,
  UserStringOperand,
} from "#/configure/types/permission-operand.types";
import type { InferredAttributeMap } from "#/runtime/types";

type EqualityOperator = "=" | "!=";

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
 * `auth.userProfile.attributes` (or `auth.machineUserAttributes` when
 * `userProfile` is omitted) become available as types.
 */
export type ResolverPermissionCondition<User extends object = InferredAttributeMap> =
  | StringEqualityCondition<User>
  | BooleanEqualityCondition<User>;

/**
 * A single access policy, in the same style as TailorDB's `.permission()`
 * policies.
 */
export type ResolverPermissionPolicy<User extends object = InferredAttributeMap> = {
  conditions: ResolverPermissionCondition<User> | readonly ResolverPermissionCondition<User>[];
  /** Whether matching callers are granted (`true`) or denied (`false`) access. */
  permit: boolean;
  description?: string;
};

/**
 * Access requirement for a resolver, evaluated against the original caller
 * (`context.user`) before `body` runs — unaffected by `authInvoker`.
 *
 * A `permit: false` policy always denies matching callers. With no
 * `permit: true` policy, this is a pure blocklist (everyone else is allowed);
 * with at least one, it's an allow-list (deny by default, granted only by a
 * matching `permit: true` policy).
 * @example
 * const permission: ResolverPermission = [
 *   { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
 * ];
 * @example
 * // Allow machine-user callers unconditionally, gate regular users behind a role
 * const permission: ResolverPermission = [
 *   { conditions: [[{ user: "isServiceAccount" }, "=", true]], permit: true },
 *   { conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true },
 * ];
 */
export type ResolverPermission<User extends object = InferredAttributeMap> =
  readonly ResolverPermissionPolicy<User>[];
