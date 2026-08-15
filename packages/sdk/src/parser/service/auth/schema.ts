import * as v from "valibot";
import { AuthConnectionConfigSchema } from "#/parser/service/auth-connection/index";
import { functionSchema } from "#/parser/service/common";
import { TailorFieldSchema } from "#/parser/service/field/schema";
import { stripTailorDBTypeBuilderHelpers } from "#/parser/service/tailordb/builder-helpers";
import { TailorDBTypeSchema } from "#/parser/service/tailordb/index";
import type { ValueOperand } from "#/configure/services/auth/types";
import type { TailorDBInstance } from "#/configure/services/tailordb/types";

export const AuthInvokerObjectSchema = v.strictObject({
  namespace: v.pipe(v.string(), v.description("Auth namespace")),
  machineUserName: v.pipe(v.string(), v.description("Machine user name for authentication")),
});

export const AuthInvokerSchema = v.union([
  v.pipe(
    v.string(),
    v.description("Machine user name (namespace auto-resolved from auth service)"),
  ),
  AuthInvokerObjectSchema,
]);

const secretValueSchema = v.strictObject({
  vaultName: v.pipe(v.string(), v.description("Vault name containing the secret")),
  secretKey: v.pipe(v.string(), v.description("Key of the secret in the vault")),
});

export const OIDCSchema = v.strictObject({
  name: v.pipe(v.string(), v.description("Identity provider name")),
  kind: v.literal("OIDC"),
  clientID: v.pipe(v.string(), v.description("OAuth2 client ID")),
  clientSecret: v.pipe(secretValueSchema, v.description("OAuth2 client secret")),
  providerURL: v.pipe(v.string(), v.description("OIDC provider URL")),
  issuerURL: v.optional(
    v.pipe(v.string(), v.description("OIDC issuer URL (defaults to providerURL)")),
  ),
  usernameClaim: v.optional(v.pipe(v.string(), v.description("JWT claim to use as username"))),
});

export const SAMLSchema = v.pipe(
  v.strictObject({
    name: v.pipe(v.string(), v.description("Identity provider name")),
    kind: v.literal("SAML"),
    enableSignRequest: v.optional(
      v.pipe(v.boolean(), v.description("Enable signing of SAML requests")),
      false,
    ),
    metadataURL: v.optional(
      v.pipe(
        v.string(),
        v.description("URL to fetch SAML metadata (mutually exclusive with rawMetadata)"),
      ),
    ),
    rawMetadata: v.optional(
      v.pipe(
        v.string(),
        v.description("Raw SAML metadata XML (mutually exclusive with metadataURL)"),
      ),
    ),
    defaultRedirectURL: v.optional(
      v.pipe(
        v.string(),
        v.description(
          "URL to redirect to when SAML ACS receives a response with an empty RelayState.",
        ),
      ),
    ),
  }),
  v.check((value) => {
    const hasMetadata = value.metadataURL !== undefined;
    const hasRaw = value.rawMetadata !== undefined;
    return hasMetadata !== hasRaw;
  }, "Provide either metadataURL or rawMetadata"),
);

export const IDTokenSchema = v.strictObject({
  name: v.pipe(v.string(), v.description("Identity provider name")),
  kind: v.literal("IDToken"),
  providerURL: v.pipe(v.string(), v.description("ID token provider URL")),
  issuerURL: v.optional(v.pipe(v.string(), v.description("ID token issuer URL"))),
  clientID: v.pipe(v.string(), v.description("Client ID for ID token validation")),
  usernameClaim: v.optional(v.pipe(v.string(), v.description("JWT claim to use as username"))),
});

export const BuiltinIdPSchema = v.strictObject({
  name: v.pipe(v.string(), v.description("Identity provider name")),
  kind: v.literal("BuiltInIdP"),
  namespace: v.pipe(v.string(), v.description("IdP namespace")),
  clientName: v.pipe(v.string(), v.description("OAuth2 client name in the IdP")),
});

export const IdProviderSchema = v.variant("kind", [
  OIDCSchema,
  SAMLSchema,
  IDTokenSchema,
  BuiltinIdPSchema,
]);

export const OAuth2ClientGrantTypeSchema = v.pipe(
  v.union([v.literal("authorization_code"), v.literal("refresh_token")]),
  v.description("OAuth2 grant type"),
);

// Redirect URIs accepted for OAuth2 clients: absolute http(s) URLs, or the
// app-scheme placeholders `<scheme>:url` / `<scheme>:url/<path>` resolved at
// deployment time. There is no valibot template-literal schema, so the shape
// is validated with an explicit predicate instead.
const oauth2RedirectURISchema = v.custom<
  `https://${string}` | `http://${string}` | `${string}:url` | `${string}:url/${string}`
>(
  (val) =>
    typeof val === "string" &&
    (val.startsWith("https://") ||
      val.startsWith("http://") ||
      val.endsWith(":url") ||
      val.includes(":url/")),
);

export const OAuth2ClientSchema = v.pipe(
  v.strictObject({
    description: v.optional(v.pipe(v.string(), v.description("Client description"))),
    grantTypes: v.optional(
      v.pipe(v.array(OAuth2ClientGrantTypeSchema), v.description("Allowed OAuth2 grant types")),
      ["authorization_code", "refresh_token"],
    ),
    redirectURIs: v.pipe(v.array(oauth2RedirectURISchema), v.description("Allowed redirect URIs")),
    clientType: v.optional(
      v.pipe(
        v.union([v.literal("confidential"), v.literal("public"), v.literal("browser")]),
        v.description("OAuth2 client type"),
      ),
    ),
    accessTokenLifetimeSeconds: v.pipe(
      v.optional(
        v.pipe(
          v.number(),
          v.integer(),
          v.minValue(60, "Minimum access token lifetime is 60 seconds"),
          v.maxValue(86400, "Maximum access token lifetime is 1 day (86400 seconds)"),
          v.description("Access token lifetime in seconds (60-86400)"),
        ),
      ),
      v.transform((val) => (val ? { seconds: BigInt(val), nanos: 0 } : undefined)),
    ),
    refreshTokenLifetimeSeconds: v.pipe(
      v.optional(
        v.pipe(
          v.number(),
          v.integer(),
          v.minValue(60, "Minimum refresh token lifetime is 60 seconds"),
          v.maxValue(604800, "Maximum refresh token lifetime is 7 days (604800 seconds)"),
          v.description("Refresh token lifetime in seconds (60-604800)"),
        ),
      ),
      v.transform((val) => (val ? { seconds: BigInt(val), nanos: 0 } : undefined)),
    ),
    requireDpop: v.optional(
      v.pipe(
        v.boolean(),
        v.description("Require DPoP (Demonstrating Proof-of-Possession) for token requests"),
      ),
    ),
  }),
  v.forward(
    v.check(
      (data) => !(data.clientType === "browser" && data.requireDpop === true),
      "requireDpop cannot be set to true for browser clients as they don't support DPoP",
    ),
    ["requireDpop"],
  ),
);

export const SCIMAuthorizationSchema = v.strictObject({
  type: v.pipe(
    v.union([v.literal("oauth2"), v.literal("bearer")]),
    v.description("SCIM authorization type"),
  ),
  bearerSecret: v.optional(
    v.pipe(secretValueSchema, v.description("Bearer token secret (required for bearer type)")),
  ),
});

export const SCIMAttributeTypeSchema = v.pipe(
  v.union([
    v.literal("string"),
    v.literal("number"),
    v.literal("boolean"),
    v.literal("datetime"),
    v.literal("complex"),
  ]),
  v.description("SCIM attribute data type"),
);

interface SCIMAttribute {
  type: "string" | "number" | "boolean" | "datetime" | "complex";
  name: string;
  description?: string;
  mutability?: "readOnly" | "readWrite" | "writeOnly";
  required?: boolean;
  multiValued?: boolean;
  uniqueness?: "none" | "server" | "global";
  canonicalValues?: string[] | null;
  subAttributes?: SCIMAttribute[] | null;
}

export const SCIMAttributeSchema = v.strictObject({
  type: v.pipe(SCIMAttributeTypeSchema, v.description("Attribute data type")),
  name: v.pipe(v.string(), v.description("Attribute name")),
  description: v.optional(v.pipe(v.string(), v.description("Attribute description"))),
  mutability: v.optional(
    v.pipe(
      v.union([v.literal("readOnly"), v.literal("readWrite"), v.literal("writeOnly")]),
      v.description("Attribute mutability"),
    ),
  ),
  required: v.optional(v.pipe(v.boolean(), v.description("Whether the attribute is required"))),
  multiValued: v.optional(
    v.pipe(v.boolean(), v.description("Whether the attribute can have multiple values")),
  ),
  uniqueness: v.optional(
    v.pipe(
      v.union([v.literal("none"), v.literal("server"), v.literal("global")]),
      v.description("Uniqueness constraint"),
    ),
  ),
  canonicalValues: v.optional(
    v.nullable(v.pipe(v.array(v.string()), v.description("List of canonical values"))),
  ),
  get subAttributes(): v.OptionalSchema<
    v.NullableSchema<v.ArraySchema<v.GenericSchema<SCIMAttribute>, undefined>, undefined>,
    undefined
  > {
    return v.optional(v.nullable(v.array(SCIMAttributeSchema)));
  },
});

const SCIMSchemaSchema = v.strictObject({
  name: v.pipe(v.string(), v.description("SCIM schema name")),
  attributes: v.pipe(v.array(SCIMAttributeSchema), v.description("Schema attributes")),
});

export const SCIMAttributeMappingSchema = v.strictObject({
  tailorDBField: v.pipe(v.string(), v.description("TailorDB field name to map to")),
  scimPath: v.pipe(v.string(), v.description("SCIM attribute path")),
});

export const SCIMResourceSchema = v.strictObject({
  name: v.pipe(v.string(), v.description("SCIM resource name")),
  tailorDBNamespace: v.pipe(v.string(), v.description("TailorDB namespace for the resource")),
  tailorDBType: v.pipe(v.string(), v.description("TailorDB table name for the resource")),
  coreSchema: v.pipe(SCIMSchemaSchema, v.description("Core SCIM schema definition")),
  attributeMapping: v.pipe(
    v.array(SCIMAttributeMappingSchema),
    v.description("Attribute mapping configuration"),
  ),
});

export const SCIMSchema = v.strictObject({
  machineUserName: v.pipe(v.string(), v.description("Machine user name for SCIM operations")),
  authorization: v.pipe(SCIMAuthorizationSchema, v.description("SCIM authorization configuration")),
  resources: v.pipe(v.array(SCIMResourceSchema), v.description("SCIM resource definitions")),
});

export const TenantProviderSchema = v.strictObject({
  namespace: v.pipe(v.string(), v.description("TailorDB namespace for the tenant table")),
  type: v.pipe(v.string(), v.description("TailorDB table name for tenants")),
  signatureField: v.pipe(v.string(), v.description("Field used as the tenant signature")),
});

const UserProfileSchema = v.strictObject({
  namespace: v.optional(
    v.pipe(v.string(), v.description("TailorDB namespace where the user table is defined")),
  ),
  type: v.pipe(
    v.custom<TailorDBInstance>(() => true),
    v.transform((val: TailorDBInstance) => stripTailorDBTypeBuilderHelpers(val)),
    TailorDBTypeSchema,
  ),
  usernameField: v.string(),
  attributes: v.optional(v.record(v.string(), v.literal(true))),
  attributeList: v.optional(v.array(v.string())),
});

const ValueOperandSchema: v.GenericSchema<ValueOperand> = v.union([
  v.string(),
  v.boolean(),
  v.array(v.string()),
  v.array(v.boolean()),
]);

const MachineUserSchema = v.strictObject({
  // null/undefined values mean "attribute not set" and are dropped so
  // downstream (deploy, drift diff) only ever sees concrete values.
  attributes: v.optional(
    v.pipe(
      v.record(v.string(), v.nullish(ValueOperandSchema)),
      v.transform(
        (attributes): Record<string, ValueOperand> =>
          Object.fromEntries(
            Object.entries(attributes).filter(
              (entry): entry is [string, ValueOperand] => entry[1] != null,
            ),
          ),
      ),
    ),
  ),
  attributeList: v.optional(v.array(v.pipe(v.string(), v.uuid()))),
});

const BeforeLoginHookSchema = v.strictObject({
  handler: functionSchema,
  invoker: v.string(),
});

const AuthConfigBaseSchema = v.strictObject({
  name: v.pipe(v.string(), v.description("Auth service name")),
  hooks: v.optional(
    v.pipe(
      v.strictObject({
        beforeLogin: v.optional(
          v.pipe(BeforeLoginHookSchema, v.description("Before login auth hook")),
        ),
      }),
      v.description("Auth hooks"),
    ),
  ),
  machineUsers: v.optional(
    v.pipe(v.record(v.string(), MachineUserSchema), v.description("Machine user definitions")),
  ),
  oauth2Clients: v.optional(
    v.pipe(v.record(v.string(), OAuth2ClientSchema), v.description("OAuth2 client definitions")),
  ),
  idProvider: v.optional(
    v.pipe(IdProviderSchema, v.description("Identity provider configuration")),
  ),
  scim: v.optional(v.pipe(SCIMSchema, v.description("SCIM provisioning configuration"))),
  tenantProvider: v.optional(
    v.pipe(TenantProviderSchema, v.description("Multi-tenant provider configuration")),
  ),
  connections: v.optional(
    v.pipe(
      v.record(v.string(), AuthConnectionConfigSchema),
      v.description("Auth connection definitions for external OAuth2 providers"),
    ),
  ),
  publishSessionEvents: v.optional(
    v.pipe(v.boolean(), v.description("Enable publishing session events")),
  ),
});

const AUTH_CONFIG_MUTEX_MESSAGE =
  "Specify either `userProfile` or `machineUserAttributes`, not both.";

function hasBothAuthConfigVariantFields(input: unknown): boolean {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const record = input as Record<string, unknown>;
  return record.userProfile !== undefined && record.machineUserAttributes !== undefined;
}

const AuthConfigWithUserProfileSchema = v.strictObject({
  ...AuthConfigBaseSchema.entries,
  userProfile: v.optional(v.pipe(UserProfileSchema, v.description("User profile configuration"))),
  machineUserAttributes: v.optional(v.undefined()),
});

const AuthConfigWithMachineUserAttributesSchema = v.strictObject({
  ...AuthConfigBaseSchema.entries,
  userProfile: v.optional(v.undefined()),
  machineUserAttributes: v.pipe(
    v.record(v.string(), TailorFieldSchema),
    v.description("Machine user attribute fields"),
  ),
});

export const AuthConfigSchema = v.pipe(
  v.union([AuthConfigWithUserProfileSchema, AuthConfigWithMachineUserAttributesSchema], (issue) =>
    hasBothAuthConfigVariantFields(issue.input)
      ? AUTH_CONFIG_MUTEX_MESSAGE
      : "Invalid auth configuration",
  ),
  v.brand("AuthConfig"),
);
