import * as v from "valibot";

const namePattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const nameSchema = v.pipe(v.string(), v.regex(namePattern));

const secretsVaultSchema = v.record(nameSchema, v.nullish(v.string()));
export const SecretsSchema = v.strictObject({
  vaults: v.record(nameSchema, secretsVaultSchema),
  options: v.strictObject({
    ignoreNullishValues: v.boolean(),
  }),
});
