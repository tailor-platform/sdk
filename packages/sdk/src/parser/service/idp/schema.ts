import { z } from "zod";
import { IdPGqlOperationsSchema } from "./gql-operations";

export { IdPGqlOperationsSchema } from "./gql-operations";

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
    allowedEmailDomains: z.array(z.string()).optional(),
    allowGoogleOauth: z.boolean().optional(),
    allowMicrosoftOauth: z.boolean().optional(),
    disablePasswordAuth: z.boolean().optional(),
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
  )
  .refine(
    (data) =>
      !data.allowedEmailDomains ||
      data.allowedEmailDomains.length === 0 ||
      !data.useNonEmailIdentifier,
    {
      message: "allowedEmailDomains cannot be set when useNonEmailIdentifier is true",
      path: ["allowedEmailDomains"],
    },
  )
  .refine(
    (data) =>
      data.allowGoogleOauth === undefined ||
      data.allowGoogleOauth === false ||
      !data.useNonEmailIdentifier,
    {
      message: "allowGoogleOauth cannot be set when useNonEmailIdentifier is true",
      path: ["allowGoogleOauth"],
    },
  )
  .refine(
    (data) =>
      !data.allowGoogleOauth || (data.allowedEmailDomains && data.allowedEmailDomains.length > 0),
    {
      message: "allowGoogleOauth requires allowedEmailDomains to be set",
      path: ["allowGoogleOauth"],
    },
  )
  .refine(
    (data) =>
      data.allowMicrosoftOauth === undefined ||
      data.allowMicrosoftOauth === false ||
      !data.useNonEmailIdentifier,
    {
      message: "allowMicrosoftOauth cannot be set when useNonEmailIdentifier is true",
      path: ["allowMicrosoftOauth"],
    },
  )
  .refine(
    (data) =>
      !data.allowMicrosoftOauth ||
      (data.allowedEmailDomains && data.allowedEmailDomains.length > 0),
    {
      message: "allowMicrosoftOauth requires allowedEmailDomains to be set",
      path: ["allowMicrosoftOauth"],
    },
  )
  .refine(
    (data) =>
      !data.disablePasswordAuth ||
      data.allowGoogleOauth === true ||
      data.allowMicrosoftOauth === true,
    {
      message: "disablePasswordAuth requires allowGoogleOauth or allowMicrosoftOauth to be enabled",
      path: ["disablePasswordAuth"],
    },
  )
  .refine((data) => !data.disablePasswordAuth || !data.allowSelfPasswordReset, {
    message: "disablePasswordAuth cannot be used with allowSelfPasswordReset",
    path: ["disablePasswordAuth"],
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
    publishUserEvents: z.boolean().optional(),
    gqlOperations: IdPGqlOperationsSchema.optional(),
  })
  .brand("IdPConfig");
