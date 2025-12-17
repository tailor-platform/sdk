import type {
  AuthConfigSchema,
  AuthInvokerSchema,
  BuiltinIdPSchema,
  IDTokenSchema,
  IdProviderSchema,
  OAuth2ClientGrantTypeSchema,
  OAuth2ClientSchema,
  OIDCSchema,
  SAMLSchema,
  SCIMAttributeMappingSchema,
  SCIMAttributeSchema,
  SCIMAttributeTypeSchema,
  SCIMAuthorizationSchema,
  SCIMResourceSchema,
  SCIMSchema as SCIMSchemaType,
  TenantProviderSchema,
} from "./schema";
import type { TailorDBInstance } from "@/configure/services/tailordb/schema";
import type { output } from "@/configure/types/helpers";
import type { IsAny } from "type-fest";
import type { z } from "zod";

export type AuthInvoker = z.output<typeof AuthInvokerSchema>;

// Types derived from zod schemas
export type OIDC = z.output<typeof OIDCSchema>;
export type SAML = z.output<typeof SAMLSchema>;
export type IDToken = z.output<typeof IDTokenSchema>;
export type BuiltinIdP = z.output<typeof BuiltinIdPSchema>;
export type IdProviderConfig = z.output<typeof IdProviderSchema>;
export type OAuth2ClientGrantType = z.output<
  typeof OAuth2ClientGrantTypeSchema
>;
// OAuth2Client input type (before transform) for configure layer
export type OAuth2ClientInput = z.input<typeof OAuth2ClientSchema>;
// OAuth2Client output type (after transform) for parser/cli layers
export type OAuth2Client = z.output<typeof OAuth2ClientSchema>;
export type SCIMAuthorization = z.output<typeof SCIMAuthorizationSchema>;
export type SCIMAttributeType = z.output<typeof SCIMAttributeTypeSchema>;
export type SCIMAttribute = z.output<typeof SCIMAttributeSchema>;
export type SCIMAttributeMapping = z.output<typeof SCIMAttributeMappingSchema>;
export type SCIMResource = z.output<typeof SCIMResourceSchema>;
export type SCIMConfig = z.output<typeof SCIMSchemaType>;
export type TenantProviderConfig = z.output<typeof TenantProviderSchema>;
export type AuthConfig = z.output<typeof AuthConfigSchema>;

// Helper types for ValueOperand
export type ValueOperand = string | boolean | string[] | boolean[];
export type AuthAttributeValue = ValueOperand | null | undefined;

// User field type helpers
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

// Exported user field key types
export type UsernameFieldKey<User extends TailorDBInstance> =
  IsAny<User> extends true
    ? string
    : {
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

// Helper types for AuthServiceInput
type DisallowExtraKeys<T, Allowed extends PropertyKey> = T & {
  [K in Exclude<keyof T, Allowed>]: never;
};

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

type AttributeMapSelectedKeys<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User>,
> = Extract<
  {
    [K in keyof AttributeMap]-?: undefined extends AttributeMap[K] ? never : K;
  }[keyof AttributeMap],
  UserAttributeKey<User>
>;

type UserProfile<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User>,
  AttributeList extends UserAttributeListKey<User>[],
> = {
  type: User;
  usernameField: UsernameFieldKey<User>;
  attributes?: DisallowExtraKeys<AttributeMap, UserAttributeKey<User>>;
  attributeList?: AttributeList;
};

type MachineUser<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User> = UserAttributeMap<User>,
  AttributeList extends UserAttributeListKey<User>[] = [],
> =
  IsAny<User> extends true
    ? {
        attributes: Record<string, AuthAttributeValue>;
        attributeList?: string[];
      }
    : (AttributeMapSelectedKeys<User, AttributeMap> extends never
        ? { attributes?: never }
        : {
            attributes: {
              [K in AttributeMapSelectedKeys<
                User,
                AttributeMap
              >]: K extends keyof output<User> ? output<User>[K] : never;
            } & {
              [K in Exclude<
                keyof output<User>,
                AttributeMapSelectedKeys<User, AttributeMap>
              >]?: never;
            };
          }) &
        ([] extends AttributeList
          ? { attributeList?: never }
          : { attributeList: AttributeListToTuple<User, AttributeList> });

// Input type (before parsing) - used by configure layer
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
  oauth2Clients?: Record<string, OAuth2ClientInput>;
  idProvider?: IdProviderConfig;
  scim?: SCIMConfig;
  tenantProvider?: TenantProviderConfig;
};

// Output type (after parsing) - used by cli/parser layers
export type AuthServiceOutput<
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
  idProvider?: IdProviderConfig;
  scim?: SCIMConfig;
  tenantProvider?: TenantProviderConfig;
};
