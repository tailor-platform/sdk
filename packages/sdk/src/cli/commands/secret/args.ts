import { arg } from "@politty/zod";
import { z } from "zod";
import { MAX_PIPED_SECRET_KIB } from "./value";

/**
 * Arguments for specify secret key
 */
export const vaultArgs = {
  "vault-name": arg(z.string(), {
    alias: "V",
    description: "Vault name",
  }),
};

/**
 * Arguments for specify secret key
 */
export const secretIdentifyArgs = {
  ...vaultArgs,
  name: arg(z.string(), {
    alias: "n",
    description: "Secret name",
  }),
};

/**
 * Arguments for specify secret key
 */
export const secretValueArgs = {
  ...secretIdentifyArgs,
  value: arg(z.string().optional(), {
    alias: "v",
    description: "Secret value (or use --value-stdin)",
  }),
  "value-stdin": arg(z.boolean().default(false), {
    description: "Read the secret value from standard input",
  }),
};

/**
 * Notes for commands that take a secret value
 * @param subcommand - Secret subcommand the example invokes
 * @returns Notes text for the command help
 */
export function secretValueNotes(subcommand: "create" | "update"): string {
  return `Pass the value with \`--value\`, or pipe it with \`--value-stdin\` to keep it out of shell history and process listings, for example \`printf '%s' "$STRIPE_KEY" | tailor secret ${subcommand} --vault-name api-keys --name stripe-secret-key --value-stdin\`. A piped value can be up to ${MAX_PIPED_SECRET_KIB} KiB, and one trailing newline is removed from it. In a vault managed by \`defineSecretManager()\`, the command asks for confirmation before releasing the vault from the config, which needs an interactive terminal, so pass \`--yes\` when piping the value.`;
}
