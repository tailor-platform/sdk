import type { IdPLangSchema, IdPSchema, IdPUserAuthPolicySchema } from "./schema";
import type { z } from "zod";

export type IdP = z.output<typeof IdPSchema>;
export type IdPInput = z.input<typeof IdPSchema>;
export type IdPLang = z.output<typeof IdPLangSchema>;
export type IdPUserAuthPolicy = z.output<typeof IdPUserAuthPolicySchema>;
