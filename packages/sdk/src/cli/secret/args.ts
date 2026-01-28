import { arg } from "politty";
import { z } from "zod";

/**
 * Arguments for specify secret key
 */
export const vaultArgs = {
  "vault-name": arg(z.string(), { alias: "V", description: "Vault name" }),
};

/**
 * Arguments for specify secret key
 */
export const secretIdentifyArgs = {
  ...vaultArgs,
  name: arg(z.string(), { alias: "n", description: "Secret name" }),
};

/**
 * Arguments for specify secret key
 */
export const secretValueArgs = {
  ...secretIdentifyArgs,
  value: arg(z.string(), { alias: "v", description: "Secret value" }),
};
