import type { SecretsSchema } from "./schema";
import type { z } from "zod";

export type SecretsConfigInput = z.input<typeof SecretsSchema>;
