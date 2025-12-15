import { z } from "zod";

export const IdPLangSchema = z.enum(["en", "ja"]);

export const IdPUserAuthPolicySchema = z.object({
  useNonEmailIdentifier: z.boolean().default(false),
  allowSelfPasswordReset: z.boolean().default(false),
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
    userAuthPolicy: IdPUserAuthPolicySchema.transform((input) =>
      IdPUserAuthPolicySchema.parse(input ?? {}),
    ).optional(),
  })
  .brand("IdPConfig");
