import { z } from "zod";

const secretsVaultSchema = z.record(z.string().min(1), z.string().min(1));
export const SecretsSchema = z.record(z.string().min(1), secretsVaultSchema);
