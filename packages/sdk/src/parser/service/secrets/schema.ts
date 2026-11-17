import { z } from "zod";
import { resourceNameSchema } from "#/parser/service/common";

const secretsVaultSchema = z.record(resourceNameSchema, z.string().nullish());
export const SecretsSchema = z.strictObject({
  vaults: z.record(resourceNameSchema, secretsVaultSchema),
  options: z.strictObject({
    ignoreNullishValues: z.boolean(),
  }),
});
