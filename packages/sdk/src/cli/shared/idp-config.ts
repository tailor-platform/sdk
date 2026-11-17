import type { IdPConfig } from "#/configure/services/idp/types";

/** The `idp` value of `defineConfig()`: one IdP, or an array of IdPs. */
export type IdpConfigInput = IdPConfig | readonly IdPConfig[];

/**
 * Whether `idp` is written as an array.
 * @param idp - The `idp` value of the application config
 * @returns True when `idp` is an array
 */
export function isIdpConfigList(idp: IdpConfigInput | undefined): idp is readonly IdPConfig[] {
  return Array.isArray(idp);
}

/**
 * List the IdPs an application config declares.
 * @param idp - The `idp` value of the application config
 * @returns The declared IdPs, empty when `idp` is not set
 */
export function idpConfigList(idp: IdpConfigInput | undefined): readonly IdPConfig[] {
  if (idp === undefined) return [];
  return isIdpConfigList(idp) ? idp : [idp];
}
