import type { ValueOperand } from "./auth";
import type { BuiltinIdP } from "./auth.generated";
import type { IdPInput } from "./idp.generated";

declare const idpDefinitionBrand: unique symbol;
export type IdpDefinitionBrand = { readonly [idpDefinitionBrand]: true };

export type DefinedIdp<Name extends string, Config, ClientNames extends string> = Config & {
  name: Name;
  provider(providerName: string, clientName: ClientNames): BuiltinIdP;
} & IdpDefinitionBrand;

export type IdPExternalConfig = { name: string; external: true };

export type IdPOwnConfig = Omit<DefinedIdp<string, IdPInput, string>, "provider">;

export type IdPConfig = IdPOwnConfig | IdPExternalConfig;

// IdP Permission standard types (normalized form used between parser and CLI)

export type StandardIdPPermissionOperator = "eq" | "ne" | "in" | "nin";

type IdPUserOperand = { user: string };
type IdPUserFieldOperand = { idpUser: string };
type OldIdPUserFieldOperand = { oldIdpUser: string };
type NewIdPUserFieldOperand = { newIdpUser: string };

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
};
