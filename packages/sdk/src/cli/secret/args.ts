/**
 * Arguments for specify secret key
 */
export const vaultArgs = {
  "vault-name": {
    type: "string",
    description: "Vault name",
    alias: "V",
    required: true,
  },
} as const;

/**
 * Arguments for specify secret key
 */
export const secretIdentifyArgs = {
  ...vaultArgs,
  name: {
    type: "string",
    description: "Secret name",
    alias: "n",
    required: true,
  },
} as const;

/**
 * Arguments for specify secret key
 */
export const secretValueArgs = {
  ...secretIdentifyArgs,
  value: {
    type: "string",
    description: "Secret value",
    alias: "v",
    required: true,
  },
} as const;
