import { z } from "zod";
import { resourceNameSchema } from "#/parser/service/common";

const secretValueSchema = z.string().nullish();
const secretsVaultSchema = z.record(
  resourceNameSchema,
  z.union([secretValueSchema, z.strictObject({ create: secretValueSchema })]),
);
export const SecretsSchema = z.strictObject({
  vaults: z.record(resourceNameSchema, secretsVaultSchema),
  options: z.strictObject({
    ignoreNullishValues: z.boolean(),
  }),
});
