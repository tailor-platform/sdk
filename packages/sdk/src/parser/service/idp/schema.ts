import { z } from "zod";

export const IdPLangSchema = z.enum(["en", "ja"]);

export const IdPUserAuthPolicySchema = z
  .object({
    useNonEmailIdentifier: z.boolean().optional(),
    allowSelfPasswordReset: z.boolean().optional(),
    passwordRequireUppercase: z.boolean().optional(),
    passwordRequireLowercase: z.boolean().optional(),
    passwordRequireNonAlphanumeric: z.boolean().optional(),
    passwordRequireNumeric: z.boolean().optional(),
    passwordMinLength: z
      .number()
      .int()
      .refine((val) => val >= 6 && val <= 30, {
        message: "passwordMinLength must be between 6 and 30",
      })
      .optional(),
    passwordMaxLength: z
      .number()
      .int()
      .refine((val) => val >= 6 && val <= 4096, {
        message: "passwordMaxLength must be between 6 and 4096",
      })
      .optional(),
  })
  .refine(
    (data) =>
      data.passwordMinLength === undefined ||
      data.passwordMaxLength === undefined ||
      data.passwordMinLength <= data.passwordMaxLength,
    {
      message: "passwordMinLength must be less than or equal to passwordMaxLength",
      path: ["passwordMinLength"],
    },
  );

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
