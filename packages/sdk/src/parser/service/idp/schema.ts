import * as v from "valibot";

/**
 * Normalize IdPGqlOperationsConfig (alias or object) to IdPGqlOperations object.
 * "query" alias expands to read-only mode: every mutation is disabled while
 * queries (`read`, `requestMfaSettingsUrl`) stay enabled.
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
        requestMfaSettingsUrl?: boolean;
        unenrollMfa?: boolean;
      },
) {
  if (config === "query") {
    return {
      create: false,
      update: false,
      delete: false,
      read: true,
      sendPasswordResetEmail: false,
      requestMfaSettingsUrl: true,
      unenrollMfa: false,
    };
  }
  return config;
}

/**
 * Valibot schema for IdPGqlOperations configuration with normalization transform.
 * Accepts "query" alias or detailed object, normalizes to IdPGqlOperations object.
 */
export const IdPGqlOperationsSchema = v.pipe(
  v.union([
    v.literal("query"),
    v.strictObject({
      create: v.optional(
        v.pipe(v.boolean(), v.description("Enable _createUser mutation (default: true)")),
      ),
      update: v.optional(
        v.pipe(v.boolean(), v.description("Enable _updateUser mutation (default: true)")),
      ),
      delete: v.optional(
        v.pipe(v.boolean(), v.description("Enable _deleteUser mutation (default: true)")),
      ),
      read: v.optional(
        v.pipe(v.boolean(), v.description("Enable _users and _user queries (default: true)")),
      ),
      sendPasswordResetEmail: v.optional(
        v.pipe(
          v.boolean(),
          v.description("Enable _sendPasswordResetEmail mutation (default: true)"),
        ),
      ),
      requestMfaSettingsUrl: v.optional(
        v.pipe(v.boolean(), v.description("Enable _requestMfaSettingsUrl query (default: true)")),
      ),
      unenrollMfa: v.optional(
        v.pipe(v.boolean(), v.description("Enable _unenrollMfa mutation (default: true)")),
      ),
    }),
  ]),
  v.description(
    "Configuration for GraphQL operations on IdP users.\nAll operations are enabled by default (undefined or true = enabled, false = disabled).",
  ),
  v.transform((val) => normalizeIdPGqlOperations(val)),
);

export const IdPLangSchema = v.pipe(v.picklist(["en", "ja"]), v.description("IdP UI language"));

// Origins are either a literal http(s) origin (scheme + host + optional port,
// no path/query/fragment) or a static-website `<name>:url` placeholder that
// the CLI resolves to a real origin at apply time. The placeholder branch
// uses the same slug rule as the platform's static-website name validator so
// typos like `https://app.example.com:url` are rejected instead of being
// silently interpreted as a website name at apply time.
const allowedReturnOriginPattern =
  /^(https?:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?|[a-z0-9][a-z0-9-]{1,61}[a-z0-9]:url)$/;

export const IdPUserAuthPolicySchema = v.pipe(
  v.strictObject({
    useNonEmailIdentifier: v.optional(
      v.pipe(v.boolean(), v.description("Use non-email identifier for usernames")),
    ),
    allowSelfPasswordReset: v.optional(
      v.pipe(v.boolean(), v.description("Allow users to reset their own passwords")),
    ),
    passwordRequireUppercase: v.optional(
      v.pipe(v.boolean(), v.description("Require uppercase letters in passwords")),
    ),
    passwordRequireLowercase: v.optional(
      v.pipe(v.boolean(), v.description("Require lowercase letters in passwords")),
    ),
    passwordRequireNonAlphanumeric: v.optional(
      v.pipe(v.boolean(), v.description("Require non-alphanumeric characters in passwords")),
    ),
    passwordRequireNumeric: v.optional(
      v.pipe(v.boolean(), v.description("Require numeric characters in passwords")),
    ),
    passwordMinLength: v.optional(
      v.pipe(
        v.number(),
        v.integer(),
        v.minValue(6, "passwordMinLength must be between 6 and 30"),
        v.maxValue(30, "passwordMinLength must be between 6 and 30"),
        v.description("Minimum password length (6-30)"),
      ),
    ),
    passwordMaxLength: v.optional(
      v.pipe(
        v.number(),
        v.integer(),
        v.minValue(6, "passwordMaxLength must be between 6 and 4096"),
        v.maxValue(4096, "passwordMaxLength must be between 6 and 4096"),
        v.description("Maximum password length (6-4096)"),
      ),
    ),
    allowedEmailDomains: v.optional(
      v.pipe(v.array(v.string()), v.description("Restrict registration to these email domains")),
    ),
    allowGoogleOauth: v.optional(v.pipe(v.boolean(), v.description("Enable Google OAuth login"))),
    allowMicrosoftOauth: v.optional(
      v.pipe(v.boolean(), v.description("Enable Microsoft OAuth login")),
    ),
    disablePasswordAuth: v.optional(
      v.pipe(v.boolean(), v.description("Disable password-based authentication")),
    ),
    enableMfa: v.optional(
      v.pipe(v.boolean(), v.description("Make TOTP MFA available for users in this namespace")),
    ),
    requireMfa: v.optional(
      v.pipe(
        v.boolean(),
        v.description(
          "Require TOTP MFA enrollment and challenge for password-authenticated users (requires enableMfa)",
        ),
      ),
    ),
    allowedReturnOrigins: v.optional(
      v.pipe(
        v.array(
          v.pipe(
            v.string(),
            v.regex(
              allowedReturnOriginPattern,
              'must be an http(s) origin like "https://app.example.com" (scheme + host + optional port, no path/query/fragment) or a static-website placeholder like "<name>:url"',
            ),
          ),
        ),
        v.description(
          "Application origins (scheme + host + optional port) allowed as MFA self-service return targets",
        ),
      ),
    ),
    mfaIssuer: v.optional(
      v.pipe(
        v.string(),
        v.maxLength(64, "mfaIssuer must be 64 characters or less"),
        v.description("Label shown next to the user account in authenticator apps"),
      ),
    ),
  }),
  v.forward(
    v.check(
      (data) =>
        data.passwordMinLength === undefined ||
        data.passwordMaxLength === undefined ||
        data.passwordMinLength <= data.passwordMaxLength,
      "passwordMinLength must be less than or equal to passwordMaxLength",
    ),
    ["passwordMinLength"],
  ),
  v.forward(
    v.check(
      (data) =>
        !data.allowedEmailDomains ||
        data.allowedEmailDomains.length === 0 ||
        !data.useNonEmailIdentifier,
      "allowedEmailDomains cannot be set when useNonEmailIdentifier is true",
    ),
    ["allowedEmailDomains"],
  ),
  v.forward(
    v.check(
      (data) =>
        data.allowGoogleOauth === undefined ||
        data.allowGoogleOauth === false ||
        !data.useNonEmailIdentifier,
      "allowGoogleOauth cannot be set when useNonEmailIdentifier is true",
    ),
    ["allowGoogleOauth"],
  ),
  v.forward(
    v.check(
      (data) =>
        !data.allowGoogleOauth ||
        !!(data.allowedEmailDomains && data.allowedEmailDomains.length > 0),
      "allowGoogleOauth requires allowedEmailDomains to be set",
    ),
    ["allowGoogleOauth"],
  ),
  v.forward(
    v.check(
      (data) => !data.allowMicrosoftOauth || !data.useNonEmailIdentifier,
      "allowMicrosoftOauth cannot be set when useNonEmailIdentifier is true",
    ),
    ["allowMicrosoftOauth"],
  ),
  v.forward(
    v.check(
      (data) =>
        !data.allowMicrosoftOauth ||
        !!(data.allowedEmailDomains && data.allowedEmailDomains.length > 0),
      "allowMicrosoftOauth requires allowedEmailDomains to be set",
    ),
    ["allowMicrosoftOauth"],
  ),
  v.forward(
    v.check(
      (data) => !data.allowMicrosoftOauth || data.disablePasswordAuth === true,
      "allowMicrosoftOauth requires disablePasswordAuth to be enabled",
    ),
    ["allowMicrosoftOauth"],
  ),
  v.forward(
    v.check(
      (data) =>
        !data.disablePasswordAuth ||
        data.allowGoogleOauth === true ||
        data.allowMicrosoftOauth === true,
      "disablePasswordAuth requires allowGoogleOauth or allowMicrosoftOauth to be enabled",
    ),
    ["disablePasswordAuth"],
  ),
  v.forward(
    v.check(
      (data) => !data.disablePasswordAuth || !data.allowSelfPasswordReset,
      "disablePasswordAuth cannot be used with allowSelfPasswordReset",
    ),
    ["disablePasswordAuth"],
  ),
  v.forward(
    v.check(
      (data) => !data.requireMfa || data.enableMfa === true,
      "requireMfa requires enableMfa to be enabled",
    ),
    ["requireMfa"],
  ),
  v.forward(
    v.check(
      (data) =>
        !data.enableMfa || !!(data.allowedReturnOrigins && data.allowedReturnOrigins.length > 0),
      "enableMfa requires allowedReturnOrigins to list at least one origin so MFA self-service has a valid return target",
    ),
    ["enableMfa"],
  ),
);

const emailFieldSchema = v.pipe(
  v.string(),
  v.maxLength(200, "must be 200 characters or less"),
  v.regex(/^[^\r\n]*$/, "must not contain newline characters"),
);

export const IdPEmailConfigSchema = v.pipe(
  v.strictObject({
    fromName: v.optional(
      v.pipe(emailFieldSchema, v.description("Default sender display name for emails")),
    ),
    passwordResetSubject: v.optional(
      v.pipe(emailFieldSchema, v.description("Default subject for password reset emails")),
    ),
  }),
  v.description("Namespace-level email configuration defaults"),
);

const IdPPermissionOperandSchema = v.union([
  v.string(),
  v.boolean(),
  v.pipe(v.array(v.string()), v.readonly()),
  v.pipe(v.array(v.boolean()), v.readonly()),
  v.strictObject({ user: v.string() }),
  v.strictObject({ idpUser: v.picklist(["id", "name", "disabled"]) }),
  v.strictObject({ oldIdpUser: v.picklist(["id", "name", "disabled"]) }),
  v.strictObject({ newIdpUser: v.picklist(["id", "name", "disabled"]) }),
]);

const IdPPermissionOperatorSchema = v.picklist(["=", "!=", "in", "not in"]);

const IdPPermissionConditionSchema = v.pipe(
  v.tuple([IdPPermissionOperandSchema, IdPPermissionOperatorSchema, IdPPermissionOperandSchema]),
  v.readonly(),
);

const IdPActionPermissionSchema = v.union([
  // Object format: { conditions, description?, permit? }
  v.strictObject({
    conditions: v.union([
      IdPPermissionConditionSchema,
      v.pipe(v.array(IdPPermissionConditionSchema), v.readonly()),
    ]),
    description: v.optional(v.string()),
    permit: v.optional(v.boolean()),
  }),
  // Single condition tuple: [operand, operator, operand]
  v.pipe(
    v.tuple([IdPPermissionOperandSchema, IdPPermissionOperatorSchema, IdPPermissionOperandSchema]),
    v.readonly(),
  ),
  // Single condition tuple with permit: [operand, operator, operand, permit]
  v.pipe(
    v.tuple([
      IdPPermissionOperandSchema,
      IdPPermissionOperatorSchema,
      IdPPermissionOperandSchema,
      v.boolean(),
    ]),
    v.readonly(),
  ),
  // Multiple conditions with optional trailing permit
  v.pipe(
    v.array(v.union([IdPPermissionConditionSchema, v.boolean()])),
    v.check((arr) => {
      const boolIndex = arr.findIndex((item) => typeof item === "boolean");
      return boolIndex === -1 || boolIndex === arr.length - 1;
    }, "Boolean permit flag must only appear at the end"),
    v.readonly(),
  ),
]);

export const IdPPermissionSchema = v.pipe(
  v.strictObject({
    create: v.pipe(v.array(IdPActionPermissionSchema), v.readonly()),
    read: v.pipe(v.array(IdPActionPermissionSchema), v.readonly()),
    update: v.pipe(v.array(IdPActionPermissionSchema), v.readonly()),
    delete: v.pipe(v.array(IdPActionPermissionSchema), v.readonly()),
    sendPasswordResetEmail: v.optional(v.pipe(v.array(IdPActionPermissionSchema), v.readonly())),
    unenrollMfa: v.optional(v.pipe(v.array(IdPActionPermissionSchema), v.readonly())),
  }),
  v.description("Per-operation permission policies for IdP users"),
);

export const IdPSchema = v.pipe(
  v.strictObject({
    name: v.pipe(v.string(), v.description("IdP service name")),
    authorization: v.optional(
      v.pipe(
        v.union([
          v.literal("insecure"),
          v.literal("loggedIn"),
          v.strictObject({ cel: v.string() }),
        ]),
        v.description("Authorization mode for IdP API access"),
      ),
    ),
    clients: v.pipe(
      v.array(v.string()),
      v.description("OAuth2 client names that can use this IdP"),
    ),
    lang: v.optional(v.pipe(IdPLangSchema, v.description("UI language for IdP pages"))),
    userAuthPolicy: v.optional(
      v.pipe(IdPUserAuthPolicySchema, v.description("User authentication policy configuration")),
    ),
    publishEvents: v.optional(
      v.pipe(v.boolean(), v.description("Enable publishing user lifecycle events")),
    ),
    gqlOperations: v.optional(
      v.pipe(
        IdPGqlOperationsSchema,
        v.description("Configure which GraphQL operations are enabled"),
      ),
    ),
    emailConfig: v.optional(
      v.pipe(IdPEmailConfigSchema, v.description("Namespace-level email configuration defaults")),
    ),
    permission: v.optional(
      v.pipe(IdPPermissionSchema, v.description("Per-operation permission policies for IdP users")),
    ),
  }),
  v.forward(
    v.check(
      (data) =>
        !data.userAuthPolicy?.enableMfa ||
        data.gqlOperations?.unenrollMfa === false ||
        (data.permission !== undefined && data.permission.unenrollMfa !== undefined),
      "permission.unenrollMfa must be set explicitly when userAuthPolicy.enableMfa is true (set [{ conditions: [...], permit: true }] to allow, or [] to deny all). permission itself must also be defined. The requirement is only relaxed when gqlOperations.unenrollMfa is false.",
    ),
    ["permission", "unenrollMfa"],
  ),
  v.forward(
    v.check(
      (data) =>
        !data.permission ||
        data.userAuthPolicy?.disablePasswordAuth === true ||
        data.gqlOperations?.sendPasswordResetEmail === false ||
        data.permission.sendPasswordResetEmail !== undefined,
      "permission.sendPasswordResetEmail must be set explicitly when password authentication is enabled (set [{ conditions: [...], permit: true }] to allow, or [] to deny; only optional when userAuthPolicy.disablePasswordAuth is true or gqlOperations.sendPasswordResetEmail is false)",
    ),
    ["permission", "sendPasswordResetEmail"],
  ),
  v.brand("IdPConfig"),
);
