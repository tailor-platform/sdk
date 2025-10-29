import type { IdPSchema } from "./schema";
import type { z } from "zod";

export type IdP = z.output<typeof IdPSchema>;
export type IdPInput = z.input<typeof IdPSchema>;
