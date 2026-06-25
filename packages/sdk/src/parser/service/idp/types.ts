// IdP permission standard types (normalized form shared by parser and CLI).
//
// This is a pure type module: it must contain type declarations only and may
// not reference zod or schema modules, so other layers (including configure)
// can import it type-only without pulling any runtime dependency.
import type { ValueOperand } from "#/configure/services/auth/types";

export type StandardIdPPermissionOperator = "eq" | "ne" | "in" | "nin";

export type IdPUserField = "id" | "name" | "disabled";

type IdPUserOperand = { user: string };
type IdPUserFieldOperand = { idpUser: IdPUserField };
type OldIdPUserFieldOperand = { oldIdpUser: IdPUserField };
type NewIdPUserFieldOperand = { newIdpUser: IdPUserField };

export type IdPPermissionOperand<Update extends boolean = boolean> =
  | IdPUserOperand
  | ValueOperand
  | (Update extends true ? OldIdPUserFieldOperand | NewIdPUserFieldOperand : IdPUserFieldOperand);

export type StandardIdPPermissionCondition<Update extends boolean = boolean> = readonly [
  IdPPermissionOperand<Update>,
  StandardIdPPermissionOperator,
  IdPPermissionOperand<Update>,
];

export type StandardIdPActionPermission<Update extends boolean = boolean> = {
  conditions: readonly StandardIdPPermissionCondition<Update>[];
  description?: string;
  permit: "allow" | "deny";
};

export type StandardIdPPermission = {
  create: readonly StandardIdPActionPermission<false>[];
  read: readonly StandardIdPActionPermission<false>[];
  update: readonly StandardIdPActionPermission<true>[];
  delete: readonly StandardIdPActionPermission<false>[];
  sendPasswordResetEmail: readonly StandardIdPActionPermission<false>[];
  unenrollMfa: readonly StandardIdPActionPermission<false>[];
};
