import { z } from "zod";
import type { ValueOperand } from "./types";

export const AuthInvokerSchema = z.object({
  namespace: z.string(),
  machineUserName: z.string(),
});

const secretValueSchema = z.object({
  vaultName: z.string(),
  secretKey: z.string(),
});

const samlBaseSchema = z.object({
  name: z.string(),
  kind: z.literal("SAML"),
  enableSignRequest: z.boolean().default(false),
});

export const OIDCSchema = z.object({
  name: z.string(),
  kind: z.literal("OIDC"),
  clientID: z.string(),
  clientSecret: secretValueSchema,
  providerURL: z.string(),
  issuerURL: z.string().optional(),
  usernameClaim: z.string().optional(),
});

export const SAMLSchema = samlBaseSchema
  .extend({
    metadataURL: z.string().optional(),
    rawMetadata: z.string().optional(),
  })
  .refine((value) => {
    const hasMetadata = value.metadataURL !== undefined;
    const hasRaw = value.rawMetadata !== undefined;
    return hasMetadata !== hasRaw;
  }, "Provide either metadataURL or rawMetadata");

export const IDTokenSchema = z.object({
  name: z.string(),
  kind: z.literal("IDToken"),
  providerURL: z.string(),
  issuerURL: z.string().optional(),
  clientID: z.string(),
  usernameClaim: z.string().optional(),
});

export const BuiltinIdPSchema = z.object({
  name: z.string(),
  kind: z.literal("BuiltInIdP"),
  namespace: z.string(),
  clientName: z.string(),
});

export const IdProviderSchema = z.discriminatedUnion("kind", [
  OIDCSchema,
  SAMLSchema,
  IDTokenSchema,
  BuiltinIdPSchema,
]);

export const OAuth2ClientGrantTypeSchema = z.union([
  z.literal("authorization_code"),
  z.literal("refresh_token"),
]);

export const OAuth2ClientSchema = z.object({
  description: z.string().optional(),
  grantTypes: z
    .array(OAuth2ClientGrantTypeSchema)
    .default(["authorization_code", "refresh_token"]),
  redirectURIs: z.array(
    z.union([
      z.templateLiteral(["https://", z.string()]),
      z.templateLiteral(["http://", z.string()]),
      z.templateLiteral([z.string(), ":url"]),
      z.templateLiteral([z.string(), ":url/", z.string()]),
    ]),
  ),
  clientType: z
    .union([
      z.literal("confidential"),
      z.literal("public"),
      z.literal("browser"),
    ])
    .optional(),
});

export const SCIMAuthorizationSchema = z.object({
  type: z.union([z.literal("oauth2"), z.literal("bearer")]),
  bearerSecret: secretValueSchema.optional(),
});

export const SCIMAttributeTypeSchema = z.union([
  z.literal("string"),
  z.literal("number"),
  z.literal("boolean"),
  z.literal("datetime"),
  z.literal("complex"),
]);

export const SCIMAttributeSchema = z.object({
  type: SCIMAttributeTypeSchema,
  name: z.string(),
  description: z.string().optional(),
  mutability: z
    .union([
      z.literal("readOnly"),
      z.literal("readWrite"),
      z.literal("writeOnly"),
    ])
    .optional(),
  required: z.boolean().optional(),
  multiValued: z.boolean().optional(),
  uniqueness: z
    .union([z.literal("none"), z.literal("server"), z.literal("global")])
    .optional(),
  canonicalValues: z.array(z.string()).nullable().optional(),
  get subAttributes() {
    return z.array(SCIMAttributeSchema).nullable().optional();
  },
});

export const SCIMSchemaSchema = z.object({
  name: z.string(),
  attributes: z.array(SCIMAttributeSchema),
});

export const SCIMAttributeMappingSchema = z.object({
  tailorDBField: z.string(),
  scimPath: z.string(),
});

export const SCIMResourceSchema = z.object({
  name: z.string(),
  tailorDBNamespace: z.string(),
  tailorDBType: z.string(),
  coreSchema: SCIMSchemaSchema,
  attributeMapping: z.array(SCIMAttributeMappingSchema),
});

export const SCIMSchema = z.object({
  machineUserName: z.string(),
  authorization: SCIMAuthorizationSchema,
  resources: z.array(SCIMResourceSchema),
});

export const TenantProviderSchema = z.object({
  namespace: z.string(),
  type: z.string(),
  signatureField: z.string(),
});

const UserProfileSchema = z.object({
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

export const AuthConfigSchema = z
  .object({
    name: z.string(),
    userProfile: UserProfileSchema.optional(),
    machineUsers: z.record(z.string(), MachineUserSchema).optional(),
    oauth2Clients: z.record(z.string(), OAuth2ClientSchema).optional(),
    idProvider: IdProviderSchema.optional(),
    scim: SCIMSchema.optional(),
    tenantProvider: TenantProviderSchema.optional(),
  })
  .brand("AuthConfig");
