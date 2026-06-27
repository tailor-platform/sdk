import { z } from "zod";

/**
 * Normalize IdPGqlOperationsConfig (alias or object) to IdPGqlOperations object.
 * "query" alias expands to read-only mode: { create: false, update: false, delete: false, read: true, sendPasswordResetEmail: false }
 * @param config - The config to normalize
 * @returns The normalized IdPGqlOperations object
 */
function normalizeIdPGqlOperations(
  config:
    | "query"
    | {
        create?: boolean;
        update?: boolean;
        delete?: boolean;
        read?: boolean;
        sendPasswordResetEmail?: boolean;
      },
) {
  if (config === "query") {
    return {
      create: false,
      update: false,
      delete: false,
      read: true,
      sendPasswordResetEmail: false,
    };
  }
  return config;
}

/**
 * Zod schema for IdPGqlOperations configuration with normalization transform.
 * Accepts "query" alias or detailed object, normalizes to IdPGqlOperations object.
 */
export const IdPGqlOperationsSchema = z
  .union([
    z.literal("query"),
    // strip unknown keys
    z.object({
      create: z.boolean().optional().describe("Enable _createUser mutation (default: true)"),
      update: z.boolean().optional().describe("Enable _updateUser mutation (default: true)"),
      delete: z.boolean().optional().describe("Enable _deleteUser mutation (default: true)"),
      read: z.boolean().optional().describe("Enable _users and _user queries (default: true)"),
      sendPasswordResetEmail: z
        .boolean()
        .optional()
        .describe("Enable _sendPasswordResetEmail mutation (default: true)"),
    }),
  ])
  .describe(
    "Configuration for GraphQL operations on IdP users.\nAll operations are enabled by default (undefined or true = enabled, false = disabled).",
  )
  .transform((val) => normalizeIdPGqlOperations(val));

export const IdPLangSchema = z.enum(["en", "ja"]).describe("IdP UI language");

// Origins are either a literal http(s) origin (scheme + host + optional port,
// no path/query/fragment) or a static-website `<name>:url` placeholder that
// the CLI resolves to a real origin at apply time. The placeholder branch
// uses the same slug rule as the platform's static-website name validator so
// typos like `https://app.example.com:url` are rejected instead of being
// silently interpreted as a website name at apply time.
const allowedReturnOriginPattern =
  /^(https?:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?|[a-z0-9][a-z0-9-]{1,61}[a-z0-9]:url)$/;

// strip unknown keys
export const IdPUserAuthPolicySchema = z
  .object({
    useNonEmailIdentifier: z
      .boolean()
      .optional()
      .describe("Use non-email identifier for usernames"),
    allowSelfPasswordReset: z
      .boolean()
      .optional()
      .describe("Allow users to reset their own passwords"),
    passwordRequireUppercase: z
      .boolean()
      .optional()
      .describe("Require uppercase letters in passwords"),
    passwordRequireLowercase: z
      .boolean()
      .optional()
      .describe("Require lowercase letters in passwords"),
    passwordRequireNonAlphanumeric: z
      .boolean()
      .optional()
      .describe("Require non-alphanumeric characters in passwords"),
    passwordRequireNumeric: z
      .boolean()
      .optional()
      .describe("Require numeric characters in passwords"),
    passwordMinLength: z
      .number()
      .int()
      .refine((val) => val >= 6 && val <= 30, {
        message: "passwordMinLength must be between 6 and 30",
      })
      .optional()
      .describe("Minimum password length (6-30)"),
    passwordMaxLength: z
      .number()
      .int()
      .refine((val) => val >= 6 && val <= 4096, {
        message: "passwordMaxLength must be between 6 and 4096",
      })
      .optional()
      .describe("Maximum password length (6-4096)"),
    allowedEmailDomains: z
      .array(z.string())
      .optional()
      .describe("Restrict registration to these email domains"),
    allowGoogleOauth: z.boolean().optional().describe("Enable Google OAuth login"),
    allowMicrosoftOauth: z.boolean().optional().describe("Enable Microsoft OAuth login"),
    disablePasswordAuth: z.boolean().optional().describe("Disable password-based authentication"),
    enableMfa: z
      .boolean()
      .optional()
      .describe("Make TOTP MFA available for users in this namespace"),
    requireMfa: z
      .boolean()
      .optional()
      .describe(
        "Require TOTP MFA enrollment and challenge for password-authenticated users (requires enableMfa)",
      ),
    allowedReturnOrigins: z
      .array(
        z
          .string()
          .regex(
            allowedReturnOriginPattern,
            'must be an http(s) origin like "https://app.example.com" (scheme + host + optional port, no path/query/fragment) or a static-website placeholder like "<name>:url"',
          ),
      )
      .optional()
      .describe(
        "Application origins (scheme + host + optional port) allowed as MFA self-service return targets",
      ),
    mfaIssuer: z
      .string()
      .max(64, "mfaIssuer must be 64 characters or less")
      .optional()
      .describe("Label shown next to the user account in authenticator apps"),
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
  .refine((data) => !data.allowMicrosoftOauth || !data.useNonEmailIdentifier, {
    message: "allowMicrosoftOauth cannot be set when useNonEmailIdentifier is true",
    path: ["allowMicrosoftOauth"],
  })
  .refine(
    (data) =>
      !data.allowMicrosoftOauth ||
      (data.allowedEmailDomains && data.allowedEmailDomains.length > 0),
    {
      message: "allowMicrosoftOauth requires allowedEmailDomains to be set",
      path: ["allowMicrosoftOauth"],
    },
  )
  .refine((data) => !data.allowMicrosoftOauth || data.disablePasswordAuth === true, {
    message: "allowMicrosoftOauth requires disablePasswordAuth to be enabled",
    path: ["allowMicrosoftOauth"],
  })
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
  })
  .refine((data) => !data.requireMfa || data.enableMfa === true, {
    message: "requireMfa requires enableMfa to be enabled",
    path: ["requireMfa"],
  })
  .refine(
    (data) =>
      !data.enableMfa || (data.allowedReturnOrigins && data.allowedReturnOrigins.length > 0),
    {
      message:
        "enableMfa requires allowedReturnOrigins to list at least one origin so MFA self-service has a valid return target",
      path: ["enableMfa"],
    },
  );

const emailFieldSchema = z
  .string()
  .max(200, "must be 200 characters or less")
  .regex(/^[^\r\n]*$/, "must not contain newline characters");

// strip unknown keys
export const IdPEmailConfigSchema = z
  .object({
    fromName: emailFieldSchema.optional().describe("Default sender display name for emails"),
    passwordResetSubject: emailFieldSchema
      .optional()
      .describe("Default subject for password reset emails"),
  })
  .describe("Namespace-level email configuration defaults");

const IdPPermissionOperandSchema = z.union([
  z.string(),
  z.boolean(),
  z.array(z.string()).readonly(),
  z.array(z.boolean()).readonly(),
  // strip unknown keys
  z.object({ user: z.string() }),
  // strip unknown keys
  z.object({ idpUser: z.enum(["id", "name", "disabled"]) }),
  // strip unknown keys
  z.object({ oldIdpUser: z.enum(["id", "name", "disabled"]) }),
  // strip unknown keys
  z.object({ newIdpUser: z.enum(["id", "name", "disabled"]) }),
]);

const IdPPermissionOperatorSchema = z.enum(["=", "!=", "in", "not in"]);

const IdPPermissionConditionSchema = z
  .tuple([IdPPermissionOperandSchema, IdPPermissionOperatorSchema, IdPPermissionOperandSchema])
  .readonly();

const IdPActionPermissionSchema = z.union([
  // Object format: { conditions, description?, permit? }
  // strip unknown keys
  z.object({
    conditions: z.union([
      IdPPermissionConditionSchema,
      z.array(IdPPermissionConditionSchema).readonly(),
    ]),
    description: z.string().optional(),
    permit: z.boolean().optional(),
  }),
  // Single condition tuple: [operand, operator, operand]
  z
    .tuple([IdPPermissionOperandSchema, IdPPermissionOperatorSchema, IdPPermissionOperandSchema])
    .readonly(),
  // Single condition tuple with permit: [operand, operator, operand, permit]
  z
    .tuple([
      IdPPermissionOperandSchema,
      IdPPermissionOperatorSchema,
      IdPPermissionOperandSchema,
      z.boolean(),
    ])
    .readonly(),
  // Multiple conditions with optional trailing permit
  z
    .array(z.union([IdPPermissionConditionSchema, z.boolean()]))
    .refine(
      (arr) => {
        const boolIndex = arr.findIndex((item) => typeof item === "boolean");
        return boolIndex === -1 || boolIndex === arr.length - 1;
      },
      { message: "Boolean permit flag must only appear at the end" },
    )
    .readonly(),
]);

// strip unknown keys
export const IdPPermissionSchema = z
  .object({
    create: z.array(IdPActionPermissionSchema).readonly(),
    read: z.array(IdPActionPermissionSchema).readonly(),
    update: z.array(IdPActionPermissionSchema).readonly(),
    delete: z.array(IdPActionPermissionSchema).readonly(),
    sendPasswordResetEmail: z.array(IdPActionPermissionSchema).readonly(),
    unenrollMfa: z.array(IdPActionPermissionSchema).readonly().optional(),
  })
  .describe("Per-operation permission policies for IdP users");

// strip unknown keys
export const IdPSchema = z
  .object({
    name: z.string().describe("IdP service name"),
    authorization: z
      .union([z.literal("insecure"), z.literal("loggedIn"), z.strictObject({ cel: z.string() })])
      .optional()
      .describe("Authorization mode for IdP API access"),
    clients: z.array(z.string()).describe("OAuth2 client names that can use this IdP"),
    lang: IdPLangSchema.optional().describe("UI language for IdP pages"),
    userAuthPolicy: IdPUserAuthPolicySchema.transform((input) =>
      // transform input may be undefined before schema parse
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      IdPUserAuthPolicySchema.parse(input ?? {}),
    )
      .optional()
      .describe("User authentication policy configuration"),
    publishUserEvents: z.boolean().optional().describe("Enable publishing user lifecycle events"),
    gqlOperations: IdPGqlOperationsSchema.optional().describe(
      "Configure which GraphQL operations are enabled",
    ),
    emailConfig: IdPEmailConfigSchema.optional().describe(
      "Namespace-level email configuration defaults",
    ),
    permission: IdPPermissionSchema.optional().describe(
      "Per-operation permission policies for IdP users",
    ),
  })
  .refine(
    (data) =>
      !data.userAuthPolicy?.enableMfa ||
      (data.permission !== undefined && data.permission.unenrollMfa !== undefined),
    {
      message:
        "permission.unenrollMfa must be set explicitly when userAuthPolicy.enableMfa is true (set [{ conditions: [...], permit: true }] to allow, or [] to deny all). permission itself must also be defined.",
      path: ["permission", "unenrollMfa"],
    },
  )
  .brand("IdPConfig");
