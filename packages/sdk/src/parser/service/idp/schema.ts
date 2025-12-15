import { z } from "zod";

export const IdPLangSchema = z.enum(["en", "ja"]);

export const IdPUserAuthPolicySchema = z.object({
  useNonEmailIdentifier: z.boolean().optional(),
  allowSelfPasswordReset: z.boolean().optional(),
});

export const IdPSchema = z
  .object({
    name: z.string(),
    authorization: z.union([
      z.literal("insecure"),
      z.literal("loggedIn"),
      z.object({ cel: z.string() }),
    ]),
    clients: z.array(z.string()),
    lang: IdPLangSchema.optional(),
    userAuthPolicy: IdPUserAuthPolicySchema.optional(),
  })
  .brand("IdPConfig");
