// Shared generic operand-key extraction helpers for permission-condition
// systems (TailorDB `.permission()`/`.gqlPermission()`, IdP `permission`,
// resolver `permission`). Each system's `User` type shape differs, but the
// "which keys of `User` hold a string/boolean (array)?" derivation is
// identical, so it lives here once instead of being copied per service.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type { InferredAttributes } from "#/runtime/types";

// `-?` keeps the indexed access from folding optional fields' `never` into
// `undefined`; `NonNullable` lets an optional field's value type still match.
export type StringFieldKeys<User extends object> = {
  [K in keyof User]-?: NonNullable<User[K]> extends string ? K : never;
}[keyof User];

type StringArrayFieldKeys<User extends object> = {
  [K in keyof User]-?: NonNullable<User[K]> extends string[] ? K : never;
}[keyof User];

export type BooleanFieldKeys<User extends object> = {
  [K in keyof User]-?: NonNullable<User[K]> extends boolean ? K : never;
}[keyof User];

type BooleanArrayFieldKeys<User extends object> = {
  [K in keyof User]-?: NonNullable<User[K]> extends boolean[] ? K : never;
}[keyof User];

export type UserStringOperand<User extends object = InferredAttributes> = {
  user: StringFieldKeys<User> | "id";
};

export type UserStringArrayOperand<User extends object = InferredAttributes> = {
  user: StringArrayFieldKeys<User>;
};

export type UserBooleanOperand<User extends object = InferredAttributes> = {
  user: BooleanFieldKeys<User> | "_loggedIn";
};

export type UserBooleanArrayOperand<User extends object = InferredAttributes> = {
  user: BooleanArrayFieldKeys<User>;
};
