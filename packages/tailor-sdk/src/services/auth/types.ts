import type { output } from "@/types/helpers";
import type { SecretValue } from "@/types/types";
import { z, type ZodType } from "zod";
import { type TailorDBInstance } from "../tailordb/schema";

// FIXME: SecretValue should be defined by zod schema
const secretValueSchema = z.object({
  VaultName: z.string(),
  SecretKey: z.string(),
}) satisfies ZodType<SecretValue>;

const samlBaseSchema = z.object({
  kind: z.literal("SAML"),
  spCertBase64: secretValueSchema,
  spKeyBase64: secretValueSchema,
});

export const OIDCSchema = z.object({
  kind: z.literal("OIDC"),
  clientID: z.string(),
  clientSecret: secretValueSchema,
  providerURL: z.string(),
  issuerURL: z.string().optional(),
  usernameClaim: z.string().optional(),
});
export type OIDC = z.infer<typeof OIDCSchema>;

export const SAMLSchema = z.union([
  samlBaseSchema.extend({ metadataURL: z.string() }),
  samlBaseSchema.extend({ rawMetadata: z.string() }),
]);
export type SAML = z.infer<typeof SAMLSchema>;

export const IDTokenSchema = z.object({
  kind: z.literal("IDToken"),
  providerURL: z.string(),
  issuerURL: z.string().optional(),
  clientID: z.string(),
  usernameClaim: z.string().optional(),
});
export type IDToken = z.infer<typeof IDTokenSchema>;

export const BuiltinIdPSchema = z.object({
  kind: z.literal("BuiltInIdP"),
  namespace: z.string(),
  clientName: z.string(),
});
export type BuiltinIdP = z.infer<typeof BuiltinIdPSchema>;

export const IdProviderConfigSchema = z.object({
  name: z.string(),
  config: z.union([OIDCSchema, SAMLSchema, IDTokenSchema, BuiltinIdPSchema]),
});
export type IdProviderConfig = z.infer<typeof IdProviderConfigSchema>;

export const OAuth2ClientGrantTypeSchema = z.union([
  z.literal("authorization_code"),
  z.literal("refresh_token"),
]);
export type OAuth2ClientGrantType = z.infer<typeof OAuth2ClientGrantTypeSchema>;

export const OAuth2ClientSchema = z.object({
  description: z.string().optional(),
  grantTypes: z
    .array(OAuth2ClientGrantTypeSchema)
    .default(["authorization_code", "refresh_token"]),
  redirectURIs: z.array(z.string()),
  clientType: z
    .union([
      z.literal("confidential"),
      z.literal("public"),
      z.literal("browser"),
    ])
    .optional(),
});
export type OAuth2Client = z.infer<typeof OAuth2ClientSchema>;

export const SCIMAuthorizationSchema = z.object({
  type: z.union([z.literal("oauth2"), z.literal("bearer")]),
  bearerSecret: secretValueSchema.optional(),
});
export type SCIMAuthorization = z.infer<typeof SCIMAuthorizationSchema>;

export const SCIMAttributeTypeSchema = z.union([
  z.literal("string"),
  z.literal("number"),
  z.literal("boolean"),
  z.literal("datetime"),
  z.literal("complex"),
]);
export type SCIMAttributeType = z.infer<typeof SCIMAttributeTypeSchema>;

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
export type SCIMAttribute = z.infer<typeof SCIMAttributeSchema>;

export const SCIMSchemaSchema = z.object({
  name: z.string(),
  attributes: z.array(SCIMAttributeSchema),
});
export type SCIMSchema = z.infer<typeof SCIMSchemaSchema>;

export const SCIMAttributeMappingSchema = z.object({
  tailorDBField: z.string(),
  scimPath: z.string(),
});
export type SCIMAttributeMapping = z.infer<typeof SCIMAttributeMappingSchema>;

export const SCIMResourceSchema = z.object({
  name: z.string(),
  tailorDBNamespace: z.string(),
  tailorDBType: z.string(),
  coreSchema: SCIMSchemaSchema,
  attributeMapping: z.array(SCIMAttributeMappingSchema),
});
export type SCIMResource = z.infer<typeof SCIMResourceSchema>;

export const SCIMConfigSchema = z.object({
  machineUserName: z.string(),
  authorization: SCIMAuthorizationSchema,
  resources: z.array(SCIMResourceSchema),
});
export type SCIMConfig = z.infer<typeof SCIMConfigSchema>;

export const TenantProviderConfigSchema = z.object({
  namespace: z.string(),
  type: z.string(),
  signatureField: z.string(),
});
export type TenantProviderConfig = z.infer<typeof TenantProviderConfigSchema>;

const UserProfileSchema = z.object({
  // FIXME: improve TailorDBInstance schema validation
  type: z.object({
    name: z.string(),
    referenced: z.any(),
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
type UserProfile<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User>,
  AttributeList extends UserAttributeListKey<User>[],
> = z.infer<typeof UserProfileSchema> & {
  type: User;
  usernameField: UsernameFieldKey<User>;
  attributes?: DisallowExtraKeys<AttributeMap, UserAttributeKey<User>>;
  attributeList?: AttributeList;
};

const ValueOperandSchema = z.union([
  z.string(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.boolean()),
]);
export type ValueOperand = z.infer<typeof ValueOperandSchema>;

const MachineUserSchema = z.object({
  attributes: z.record(z.string(), ValueOperandSchema).optional(),
  attributeList: z.array(z.uuid()).optional(),
});

type AttributeListValue<
  User extends TailorDBInstance,
  Key extends UserAttributeListKey<User>,
> = Key extends keyof output<User> ? output<User>[Key] : never;

type AttributeListToTuple<
  User extends TailorDBInstance,
  AttributeList extends readonly UserAttributeListKey<User>[],
> = {
  [Index in keyof AttributeList]: AttributeList[Index] extends UserAttributeListKey<User>
    ? AttributeListValue<User, AttributeList[Index]>
    : never;
};

type MachineUser<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User> = object,
  AttributeList extends UserAttributeListKey<User>[] = [],
> = (object extends AttributeMap
  ? { attributes?: never }
  : {
      attributes: {
        [K in keyof AttributeMap]: K extends keyof output<User>
          ? output<User>[K]
          : never;
      } & {
        [K in Exclude<keyof output<User>, keyof AttributeMap>]?: never;
      };
    }) &
  ([] extends AttributeList
    ? { attributeList?: never }
    : { attributeList: AttributeListToTuple<User, AttributeList> });

type UserFieldKeys<User extends TailorDBInstance> = keyof output<User> & string;

type FieldDefined<
  User extends TailorDBInstance,
  Key extends UserFieldKeys<User>,
> = User["fields"][Key] extends { _defined: infer Defined } ? Defined : never;

type FieldOutput<
  User extends TailorDBInstance,
  Key extends UserFieldKeys<User>,
> = output<User>[Key];

type FieldIsRequired<
  User extends TailorDBInstance,
  Key extends UserFieldKeys<User>,
> = undefined extends FieldOutput<User, Key> ? false : true;

type FieldIsOfType<
  User extends TailorDBInstance,
  Key extends UserFieldKeys<User>,
  Type extends string,
> = FieldDefined<User, Key> extends { type: Type } ? true : false;

type FieldIsArray<
  User extends TailorDBInstance,
  Key extends UserFieldKeys<User>,
> = FieldDefined<User, Key> extends { array: true } ? true : false;

type FieldIsUnique<
  User extends TailorDBInstance,
  Key extends UserFieldKeys<User>,
> = FieldDefined<User, Key> extends { unique: true } ? true : false;

type FieldSupportsValueOperand<
  User extends TailorDBInstance,
  Key extends UserFieldKeys<User>,
> =
  FieldOutput<User, Key> extends ValueOperand | null | undefined ? true : false;

export type UsernameFieldKey<User extends TailorDBInstance> = {
  [K in UserFieldKeys<User>]: FieldIsRequired<User, K> extends true
    ? FieldIsOfType<User, K, "string"> extends true
      ? FieldIsArray<User, K> extends true
        ? never
        : FieldIsUnique<User, K> extends true
          ? K
          : never
      : never
    : never;
}[UserFieldKeys<User>];

export type UserAttributeKey<User extends TailorDBInstance> = {
  [K in UserFieldKeys<User>]: K extends "id"
    ? never
    : FieldSupportsValueOperand<User, K> extends true
      ? FieldIsOfType<User, K, "datetime" | "date" | "time"> extends true
        ? never
        : K
      : never;
}[UserFieldKeys<User>];

export type UserAttributeListKey<User extends TailorDBInstance> = {
  [K in UserFieldKeys<User>]: K extends "id"
    ? never
    : FieldIsOfType<User, K, "uuid"> extends true
      ? FieldIsArray<User, K> extends true
        ? never
        : K
      : never;
}[UserFieldKeys<User>];

export type UserAttributeMap<User extends TailorDBInstance> = {
  [K in UserAttributeKey<User>]?: true;
};

type DisallowExtraKeys<T, Allowed extends PropertyKey> = T & {
  [K in Exclude<keyof T, Allowed>]: never;
};

export type AuthServiceInput<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User>,
  AttributeList extends UserAttributeListKey<User>[],
  MachineUserNames extends string,
> = {
  userProfile?: UserProfile<User, AttributeMap, AttributeList>;
  machineUsers?: Record<
    MachineUserNames,
    MachineUser<User, AttributeMap, AttributeList>
  >;
  oauth2Clients?: Record<string, OAuth2Client>;
  idProviderConfigs?: IdProviderConfig[];
  scimConfig?: SCIMConfig;
  tenantProviderConfig?: TenantProviderConfig;
};

export const AuthConfigSchema = z
  .object({
    name: z.string(),
    userProfile: UserProfileSchema.optional(),
    machineUsers: z.record(z.string(), MachineUserSchema).optional(),
    oauth2Clients: z.record(z.string(), OAuth2ClientSchema).optional(),
    idProviderConfigs: z.array(IdProviderConfigSchema).optional(),
    scimConfig: SCIMConfigSchema.optional(),
    tenantProviderConfig: TenantProviderConfigSchema.optional(),
  })
  .brand("AuthConfig");
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
