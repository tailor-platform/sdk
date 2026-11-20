import type { SecretsInput } from "#/types/secrets.generated";

/**
 * Read a secret entry of `defineSecretManager()`: a string or nullish value, or a
 * `{ create: value }` entry written only when the secret does not exist yet.
 * @param entry - Secret entry as written in the config
 * @returns The secret value, and whether the entry is create-only
 */
export function readSecretEntry(entry: SecretsInput["vaults"][string][string]) {
  return typeof entry === "object" && entry !== null
    ? { value: entry.create, createOnly: true }
    : { value: entry, createOnly: false };
}
