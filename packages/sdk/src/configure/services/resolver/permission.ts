import type { TailorAnyField } from "#/configure/types/field.types";
import type {
  UserBooleanOperand,
  UserStringOperand,
} from "#/configure/types/permission-operand.types";
import type { InferredAttributes } from "#/runtime/types";

type EqualityOperator = "=" | "!=";

type ComparableInputKeys<Input> =
  Input extends Record<string, TailorAnyField>
    ? {
        [K in keyof Input]-?: Input[K]["_defined"] extends {
          type: "string" | "uuid" | "enum";
          array: false;
        }
          ? K
          : never;
      }[keyof Input] &
        string
    : never;

/**
 * Refers to a top-level `input` field of the resolver: a non-array
 * `t.string()`, `t.uuid()`, or `t.enum()` field.
 */
type ResolverInputOperand<Input> = { input: ComparableInputKeys<Input> };

type StringEqualityCondition<User extends object> =
  | readonly [UserStringOperand<User>, EqualityOperator, string]
  | readonly [string, EqualityOperator, UserStringOperand<User>];

type BooleanEqualityCondition<User extends object> =
  | readonly [UserBooleanOperand<User>, EqualityOperator, boolean]
  | readonly [boolean, EqualityOperator, UserBooleanOperand<User>];

type InputEqualityCondition<User extends object, Input> =
  | readonly [ResolverInputOperand<Input>, "=", UserStringOperand<User>]
  | readonly [UserStringOperand<User>, "=", ResolverInputOperand<Input>];

/**
 * A single condition for {@link ResolverPermission}.
 *
 * Each condition compares a `user` operand with a string, a boolean, or an
 * `input` operand (unlike TailorDB's `record`/`newRecord`/`oldRecord`
 * operands — a resolver has no associated record to compare against). Only
 * equality (`=`/`!=`) is supported for now. A condition with an `input`
 * operand uses `=`, matches only when both the input value and the `user`
 * value are present strings, and is allowed only in a `permit: true` policy.
 *
 * The User type is extended by `tailor.d.ts`, which is automatically generated
 * when running `tailor generate`. Attributes enabled in the config file's
 * `auth.userProfile.attributes` (or `auth.machineUserAttributes` when
 * `userProfile` is omitted) become available as types.
 */
export type ResolverPermissionCondition<
  User extends object = InferredAttributes,
  Input = undefined,
> =
  | StringEqualityCondition<User>
  | BooleanEqualityCondition<User>
  | InputEqualityCondition<User, Input>;

type ResolverPermissionPolicyBase<Condition> = {
  conditions: Condition | readonly Condition[];
  description?: string;
};

/**
 * A single access policy, in the same style as TailorDB's `.permission()`
 * policies.
 */
export type ResolverPermissionPolicy<User extends object = InferredAttributes, Input = undefined> =
  | (ResolverPermissionPolicyBase<ResolverPermissionCondition<User, Input>> & {
      /** Whether matching callers are granted (`true`) or denied (`false`) access. */
      permit: true;
    })
  | (ResolverPermissionPolicyBase<ResolverPermissionCondition<User>> & {
      /** Whether matching callers are granted (`true`) or denied (`false`) access. */
      permit: false;
    });

/**
 * Access requirement for a resolver, evaluated against the original caller
 * (`context.user`) and the resolver's input before `body` runs — unaffected
 * by `authInvoker`.
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
 * // In `createResolver`: let a caller act only on their own employee ID, or as an admin
 * permission: [
 *   { conditions: [[{ input: "employeeId" }, "=", { user: "id" }]], permit: true },
 *   { conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true },
 * ],
 * @example
 * const permission: ResolverPermission = "allowAnonymous";
 */
export type ResolverPermission<User extends object = InferredAttributes, Input = undefined> =
  | readonly ResolverPermissionPolicy<User, Input>[]
  | "allowAnonymous";
