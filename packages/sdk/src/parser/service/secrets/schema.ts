import { z } from "zod";

const namePattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const nameSchema = z.string().regex(namePattern);

const secretsVaultSchema = z.record(nameSchema, z.string());
export const SecretsSchema = z.record(nameSchema, secretsVaultSchema);
