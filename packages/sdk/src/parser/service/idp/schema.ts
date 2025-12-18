import { z } from "zod";

export const IdPLangSchema = z.enum(["en", "ja"]);

export const IdPUserAuthPolicySchema = z
  .object({
    useNonEmailIdentifier: z.boolean().default(false),
    allowSelfPasswordReset: z.boolean().default(false),
    passwordRequireUppercase: z.boolean().default(false),
    passwordRequireLowercase: z.boolean().default(false),
    passwordRequireNonAlphanumeric: z.boolean().default(false),
    passwordRequireNumeric: z.boolean().default(false),
    passwordMinLength: z
      .number()
      .int()
      .refine((val) => val >= 6 && val <= 30, {
        message: "passwordMinLength must be between 6 and 30",
      })
      .default(6),
    passwordMaxLength: z
      .number()
      .int()
      .refine((val) => val >= 6 && val <= 4096, {
        message: "passwordMaxLength must be between 6 and 4096",
      })
      .default(4096),
  })
  .refine((data) => data.passwordMinLength <= data.passwordMaxLength, {
    message:
      "passwordMinLength must be less than or equal to passwordMaxLength",
    path: ["passwordMinLength"],
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
