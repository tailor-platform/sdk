import { z } from "zod";

const namePattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const nameSchema = z.string().regex(namePattern);

const secretsVaultSchema = z.record(nameSchema, z.string().nullish());
// strip unknown keys
export const SecretsSchema = z.object({
  vaults: z.record(nameSchema, secretsVaultSchema),
  // strip unknown keys
  options: z.object({
    ignoreNullishValues: z.boolean(),
  }),
});
