import { arg } from "@politty/valibot";
import * as v from "valibot";

/**
 * Arguments for specify secret key
 */
export const vaultArgs = {
  "vault-name": arg(v.string(), {
    alias: "V",
    description: "Vault name",
  }),
};

/**
 * Arguments for specify secret key
 */
export const secretIdentifyArgs = {
  ...vaultArgs,
  name: arg(v.string(), {
    alias: "n",
    description: "Secret name",
  }),
};

/**
 * Arguments for specify secret key
 */
export const secretValueArgs = {
  ...secretIdentifyArgs,
  value: arg(v.string(), {
    alias: "v",
    description: "Secret value",
  }),
};
