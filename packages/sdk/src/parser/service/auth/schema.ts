import { z } from "zod";
import { AuthConnectionConfigSchema } from "@/parser/service/auth-connection";
import { TailorFieldSchema } from "@/parser/service/field/schema";
import type { ValueOperand } from "@/types/auth";

export const AuthInvokerObjectSchema = z.object({
  namespace: z.string().describe("Auth namespace"),
  machineUserName: z.string().describe("Machine user name for authentication"),
});

export const AuthInvokerSchema = z.union([
  z.string().describe("Machine user name (namespace auto-resolved from auth service)"),
  AuthInvokerObjectSchema,
]);

const secretValueSchema = z.object({
  vaultName: z.string().describe("Vault name containing the secret"),
  secretKey: z.string().describe("Key of the secret in the vault"),
});

export const OIDCSchema = z.object({
  name: z.string().describe("Identity provider name"),
  kind: z.literal("OIDC"),
  clientID: z.string().describe("OAuth2 client ID"),
  clientSecret: secretValueSchema.describe("OAuth2 client secret"),
  providerURL: z.string().describe("OIDC provider URL"),
  issuerURL: z.string().optional().describe("OIDC issuer URL (defaults to providerURL)"),
  usernameClaim: z.string().optional().describe("JWT claim to use as username"),
});

export const SAMLSchema = z
  .object({
    name: z.string().describe("Identity provider name"),
    kind: z.literal("SAML"),
    enableSignRequest: z.boolean().default(false).describe("Enable signing of SAML requests"),
    metadataURL: z
      .string()
      .optional()
      .describe("URL to fetch SAML metadata (mutually exclusive with rawMetadata)"),
    rawMetadata: z
      .string()
      .optional()
      .describe("Raw SAML metadata XML (mutually exclusive with metadataURL)"),
    defaultRedirectURL: z
      .string()
      .optional()
      .describe("URL to redirect to when SAML ACS receives a response with an empty RelayState."),
  })
  .refine((value) => {
    const hasMetadata = value.metadataURL !== undefined;
    const hasRaw = value.rawMetadata !== undefined;
    return hasMetadata !== hasRaw;
  }, "Provide either metadataURL or rawMetadata");

export const IDTokenSchema = z.object({
  name: z.string().describe("Identity provider name"),
  kind: z.literal("IDToken"),
  providerURL: z.string().describe("ID token provider URL"),
  issuerURL: z.string().optional().describe("ID token issuer URL"),
  clientID: z.string().describe("Client ID for ID token validation"),
  usernameClaim: z.string().optional().describe("JWT claim to use as username"),
});

export const BuiltinIdPSchema = z.object({
  name: z.string().describe("Identity provider name"),
  kind: z.literal("BuiltInIdP"),
  namespace: z.string().describe("IdP namespace"),
  clientName: z.string().describe("OAuth2 client name in the IdP"),
});

export const IdProviderSchema = z.discriminatedUnion("kind", [
  OIDCSchema,
  SAMLSchema,
  IDTokenSchema,
  BuiltinIdPSchema,
]);

export const OAuth2ClientGrantTypeSchema = z
  .union([z.literal("authorization_code"), z.literal("refresh_token")])
  .describe("OAuth2 grant type");

export const OAuth2ClientSchema = z
  .object({
    description: z.string().optional().describe("Client description"),
    grantTypes: z
      .array(OAuth2ClientGrantTypeSchema)
      .default(["authorization_code", "refresh_token"])
      .describe("Allowed OAuth2 grant types"),
    redirectURIs: z
      .array(
        z.union([
          z.templateLiteral(["https://", z.string()]),
          z.templateLiteral(["http://", z.string()]),
          z.templateLiteral([z.string(), ":url"]),
          z.templateLiteral([z.string(), ":url/", z.string()]),
        ]),
      )
      .describe("Allowed redirect URIs"),
    clientType: z
      .union([z.literal("confidential"), z.literal("public"), z.literal("browser")])
      .optional()
      .describe("OAuth2 client type"),
    accessTokenLifetimeSeconds: z
      .number()
      .int()
      .min(60, "Minimum access token lifetime is 60 seconds")
      .max(86400, "Maximum access token lifetime is 1 day (86400 seconds)")
      .optional()
      .describe("Access token lifetime in seconds (60-86400)")
      .transform((val) => (val ? { seconds: BigInt(val), nanos: 0 } : undefined)),
    refreshTokenLifetimeSeconds: z
      .number()
      .int()
      .min(60, "Minimum refresh token lifetime is 60 seconds")
      .max(604800, "Maximum refresh token lifetime is 7 days (604800 seconds)")
      .optional()
      .describe("Refresh token lifetime in seconds (60-604800)")
      .transform((val) => (val ? { seconds: BigInt(val), nanos: 0 } : undefined)),
    requireDpop: z
      .boolean()
      .optional()
      .describe("Require DPoP (Demonstrating Proof-of-Possession) for token requests"),
  })
  .refine((data) => !(data.clientType === "browser" && data.requireDpop === true), {
    message: "requireDpop cannot be set to true for browser clients as they don't support DPoP",
    path: ["requireDpop"],
  });

export const SCIMAuthorizationSchema = z.object({
  type: z.union([z.literal("oauth2"), z.literal("bearer")]).describe("SCIM authorization type"),
  bearerSecret: secretValueSchema
    .optional()
    .describe("Bearer token secret (required for bearer type)"),
});

export const SCIMAttributeTypeSchema = z
  .union([
    z.literal("string"),
    z.literal("number"),
    z.literal("boolean"),
    z.literal("datetime"),
    z.literal("complex"),
  ])
  .describe("SCIM attribute data type");

export const SCIMAttributeSchema = z.object({
  type: SCIMAttributeTypeSchema.describe("Attribute data type"),
  name: z.string().describe("Attribute name"),
  description: z.string().optional().describe("Attribute description"),
  mutability: z
    .union([z.literal("readOnly"), z.literal("readWrite"), z.literal("writeOnly")])
    .optional()
    .describe("Attribute mutability"),
  required: z.boolean().optional().describe("Whether the attribute is required"),
  multiValued: z.boolean().optional().describe("Whether the attribute can have multiple values"),
  uniqueness: z
    .union([z.literal("none"), z.literal("server"), z.literal("global")])
    .optional()
    .describe("Uniqueness constraint"),
  canonicalValues: z.array(z.string()).nullable().optional().describe("List of canonical values"),
  get subAttributes() {
    return z.array(SCIMAttributeSchema).nullable().optional();
  },
});

const SCIMSchemaSchema = z.object({
  name: z.string().describe("SCIM schema name"),
  attributes: z.array(SCIMAttributeSchema).describe("Schema attributes"),
});

export const SCIMAttributeMappingSchema = z.object({
  tailorDBField: z.string().describe("TailorDB field name to map to"),
  scimPath: z.string().describe("SCIM attribute path"),
});

export const SCIMResourceSchema = z.object({
  name: z.string().describe("SCIM resource name"),
  tailorDBNamespace: z.string().describe("TailorDB namespace for the resource"),
  tailorDBType: z.string().describe("TailorDB type name for the resource"),
  coreSchema: SCIMSchemaSchema.describe("Core SCIM schema definition"),
  attributeMapping: z.array(SCIMAttributeMappingSchema).describe("Attribute mapping configuration"),
});

export const SCIMSchema = z.object({
  machineUserName: z.string().describe("Machine user name for SCIM operations"),
  authorization: SCIMAuthorizationSchema.describe("SCIM authorization configuration"),
  resources: z.array(SCIMResourceSchema).describe("SCIM resource definitions"),
});

export const TenantProviderSchema = z.object({
  namespace: z.string().describe("TailorDB namespace for the tenant type"),
  type: z.string().describe("TailorDB type name for tenants"),
  signatureField: z.string().describe("Field used as the tenant signature"),
});

const UserProfileSchema = z.object({
  namespace: z.string().optional().describe("TailorDB namespace where the user type is defined"),
  // FIXME: improve TailorDBInstance schema validation
  type: z.object({
    name: z.string(),
    fields: z.any(),
    metadata: z.any(),
    hooks: z.any(),
    validate: z.any(),
    features: z.any(),
    indexes: z.any(),
    files: z.any(),
    permission: z.any(),
    gqlPermission: z.any(),
    _output: z.any(),
  }),
  usernameField: z.string(),
  attributes: z.record(z.string(), z.literal(true)).optional(),
  attributeList: z.array(z.string()).optional(),
});

const ValueOperandSchema: z.ZodType<ValueOperand> = z.union([
  z.string(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.boolean()),
]);

const MachineUserSchema = z.object({
  attributes: z.record(z.string(), ValueOperandSchema).optional(),
  attributeList: z.array(z.uuid()).optional(),
});

const BeforeLoginHookSchema = z.object({
  handler: z.function(),
  invoker: z.string(),
});

const AuthConfigBaseSchema = z.object({
  name: z.string().describe("Auth service name"),
  hooks: z
    .object({
      beforeLogin: BeforeLoginHookSchema.optional().describe("Before login auth hook"),
    })
    .optional()
    .describe("Auth hooks"),
  machineUsers: z
    .record(z.string(), MachineUserSchema)
    .optional()
    .describe("Machine user definitions"),
  oauth2Clients: z
    .record(z.string(), OAuth2ClientSchema)
    .optional()
    .describe("OAuth2 client definitions"),
  idProvider: IdProviderSchema.optional().describe("Identity provider configuration"),
  scim: SCIMSchema.optional().describe("SCIM provisioning configuration"),
  tenantProvider: TenantProviderSchema.optional().describe("Multi-tenant provider configuration"),
  connections: z
    .record(z.string(), AuthConnectionConfigSchema)
    .optional()
    .describe("Auth connection definitions for external OAuth2 providers"),
  publishSessionEvents: z.boolean().optional().describe("Enable publishing session events"),
});

export const AuthConfigSchema = z
  .xor(
    [
      AuthConfigBaseSchema.extend({
        userProfile: UserProfileSchema.optional().describe("User profile configuration"),
        machineUserAttributes: z.undefined().optional(),
      }),
      AuthConfigBaseSchema.extend({
        userProfile: z.undefined().optional(),
        machineUserAttributes: z
          .record(z.string(), TailorFieldSchema)
          .describe("Machine user attribute fields"),
      }),
    ],
    {
      error: (iss) => {
        if (iss.code !== "invalid_union") return undefined;
        if (iss.errors.length < 2) return undefined;
        const isOnlyMutexViolation = iss.errors.every((variantErrors) =>
          variantErrors.every(
            (e) =>
              e.path.length === 1 &&
              (e.path[0] === "userProfile" || e.path[0] === "machineUserAttributes"),
          ),
        );
        if (isOnlyMutexViolation) {
          return "Specify either `userProfile` or `machineUserAttributes`, not both.";
        }
        return undefined;
      },
    },
  )
  .brand("AuthConfig");
