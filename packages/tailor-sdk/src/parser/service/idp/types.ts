import type { z } from "zod";
import type { IdPSchema } from "./schema";

export type IdP = z.output<typeof IdPSchema>;
export type IdPInput = z.input<typeof IdPSchema>;
