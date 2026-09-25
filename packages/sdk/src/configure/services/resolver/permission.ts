import type {
  UserBooleanOperand,
  UserStringOperand,
} from "#/configure/types/permission-operand.types";
import type { InferredAttributes } from "#/runtime/types";

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
 * when running `tailor generate`. Attributes enabled in the config file's
 * `auth.userProfile.attributes` (or `auth.machineUserAttributes` when
 * `userProfile` is omitted) become available as types.
 */
export type ResolverPermissionCondition<User extends object = InferredAttributes> =
  | StringEqualityCondition<User>
  | BooleanEqualityCondition<User>;

/**
 * A single access policy, in the same style as TailorDB's `.permission()`
 * policies.
 */
export type ResolverPermissionPolicy<User extends object = InferredAttributes> = {
  conditions: ResolverPermissionCondition<User> | readonly ResolverPermissionCondition<User>[];
  /** Whether matching callers are granted (`true`) or denied (`false`) access. */
  permit: boolean;
  description?: string;
};

/**
 * Access requirement for a resolver, evaluated against the original caller
 * (`context.user`) before `body` runs — unaffected by `authInvoker`.
 *
 * At least one `permit: true` policy is required: a caller is granted only by
 * a matching `permit: true` policy (deny by default), and a matching
 * `permit: false` policy always overrides that grant, even when another
 * policy would otherwise allow the same caller — use it to carve out an
 * explicit exception from a broader grant. A policy array with only
 * `permit: false` policies is rejected, since none of its conditions apply to
 * a caller presenting no user attributes at all (e.g. one who simply doesn't
 * authenticate), so it wouldn't actually keep anyone out. `"allowAnonymous"`
 * explicitly documents that anonymous callers are allowed.
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
 * @example
 * // Exception: allow logged-in users broadly, but reject a banned role
 * const permission: ResolverPermission = [
 *   { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
 *   { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false },
 * ];
 * @example
 * const permission: ResolverPermission = "allowAnonymous";
 */
export type ResolverPermission<User extends object = InferredAttributes> =
  | readonly ResolverPermissionPolicy<User>[]
  | "allowAnonymous";
