import { z } from "zod";

const secretsVaultSchema = z.record(z.string(), z.string());
export const SecretsSchema = z.record(z.string(), secretsVaultSchema);

export type SecretsConfig = z.input<typeof SecretsSchema>;
