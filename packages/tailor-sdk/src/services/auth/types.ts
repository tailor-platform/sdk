import type { output } from "@/types/helpers";
import type { SecretValue } from "@/types/types";
import { type TailorDBType } from "../tailordb/schema";

export type ValueOperand =
  | string
  | string[]
  | boolean
  | boolean[]
  | null
  | undefined;

type UserFieldKeys<User extends TailorDBType> = keyof output<User> & string;

type FieldDefined<
  User extends TailorDBType,
  Key extends UserFieldKeys<User>,
> = User["fields"][Key] extends { _defined: infer Defined } ? Defined : never;

type FieldOutput<
  User extends TailorDBType,
  Key extends UserFieldKeys<User>,
> = output<User>[Key];

type FieldIsRequired<
  User extends TailorDBType,
  Key extends UserFieldKeys<User>,
> = undefined extends FieldOutput<User, Key> ? false : true;

type FieldIsOfType<
  User extends TailorDBType,
  Key extends UserFieldKeys<User>,
  Type extends string,
> = FieldDefined<User, Key> extends { type: Type } ? true : false;

type FieldIsArray<User extends TailorDBType, Key extends UserFieldKeys<User>> =
  FieldDefined<User, Key> extends { array: true } ? true : false;

type FieldIsUnique<User extends TailorDBType, Key extends UserFieldKeys<User>> =
  FieldDefined<User, Key> extends { unique: true } ? true : false;

type FieldSupportsValueOperand<
  User extends TailorDBType,
  Key extends UserFieldKeys<User>,
> = FieldOutput<User, Key> extends ValueOperand ? true : false;

export type UsernameFieldKey<User extends TailorDBType> = {
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

export type UserAttributeKey<User extends TailorDBType> = {
  [K in UserFieldKeys<User>]: K extends "id"
    ? never
    : FieldSupportsValueOperand<User, K> extends true
      ? FieldIsOfType<User, K, "datetime" | "date" | "time"> extends true
        ? never
        : K
      : never;
}[UserFieldKeys<User>];

export type UserAttributeListKey<User extends TailorDBType> = {
  [K in UserFieldKeys<User>]: K extends "id"
    ? never
    : FieldIsOfType<User, K, "uuid"> extends true
      ? FieldIsArray<User, K> extends true
        ? never
        : K
      : never;
}[UserFieldKeys<User>];

export interface OIDC {
  kind: "OIDC";
  clientID: string;
  clientSecret: SecretValue;
  providerURL: string;
  issuerURL?: string;
  usernameClaim?: string;
}

export type SAML = {
  kind: "SAML";
  spCertBase64: SecretValue;
  spKeyBase64: SecretValue;
} & (
  | {
      metadataURL: string;
    }
  | {
      rawMetadata: string;
    }
);

export interface IDToken {
  kind: "IDToken";
  providerURL: string;
  issuerURL?: string;
  clientID: string;
  usernameClaim?: string;
}

export interface BuiltinIdP {
  kind: "BuiltInIdP";
  namespace: string;
  clientName: string;
}

export interface UserProfileProviderConfig {
  type: string;
  usernameField: string;
  tenantIdField?: string;
  attributesFields: string[];
  attributeMap?: Record<string, string>;
}

export interface IdProviderConfig {
  name: string;
  config: OIDC | SAML | IDToken | BuiltinIdP;
}

export type UserAttributeMap<User extends TailorDBType> = {
  [K in UserAttributeKey<User>]?: true;
};

type DisallowExtraKeys<T, Allowed extends PropertyKey> = T & {
  [K in Exclude<keyof T, Allowed>]: never;
};

type AttributeListValue<
  User extends TailorDBType,
  Key extends UserAttributeListKey<User>,
> = Key extends keyof output<User> ? output<User>[Key] : never;

type AttributeListToTuple<
  User extends TailorDBType,
  AttributeList extends readonly UserAttributeListKey<User>[],
> = {
  [Index in keyof AttributeList]: AttributeList[Index] extends UserAttributeListKey<User>
    ? AttributeListValue<User, AttributeList[Index]>
    : never;
};

type MachineUser<
  User extends TailorDBType,
  AttributeMap extends UserAttributeMap<User> = object,
  AttributeList extends UserAttributeListKey<User>[] = [],
> = {
  attributes: object extends AttributeMap
    ? never
    : {
        [K in keyof AttributeMap]: K extends keyof output<User>
          ? output<User>[K]
          : never;
      } & { [K in Exclude<keyof output<User>, keyof AttributeMap>]?: never };
} & ([] extends AttributeList
  ? { attributeList?: never }
  : { attributeList: AttributeListToTuple<User, AttributeList> });

export type OAuth2ClientGrantType = "authorization_code" | "refresh_token";
export interface OAuth2Client {
  description?: string;
  grantTypes?: OAuth2ClientGrantType[];
  redirectURIs: string[];
  clientType?: "confidential" | "public" | "browser";
}

export interface SCIMAuthorization {
  type: "oauth2" | "bearer";
  bearerSecret?: SecretValue;
}

export type SCIMAttributeType =
  | "string"
  | "number"
  | "boolean"
  | "datetime"
  | "complex";

export interface SCIMAttribute {
  type: SCIMAttributeType;
  name: string;
  description?: string;
  mutability?: "readOnly" | "readWrite" | "writeOnly";
  required?: boolean;
  multiValued?: boolean;
  uniqueness?: "none" | "server" | "global";
  canonicalValues?: string[] | null;
  subAttributes?: SCIMAttribute[] | null;
}

export interface SCIMSchema {
  name: string;
  attributes: SCIMAttribute[];
}

export interface SCIMAttributeMapping {
  tailorDBField: string;
  scimPath: string;
}

export interface SCIMResource {
  name: string;
  tailorDBNamespace: string;
  tailorDBType: string;
  coreSchema: SCIMSchema;
  attributeMapping: SCIMAttributeMapping[];
}

export interface SCIMConfig {
  machineUserName: string;
  authorization: SCIMAuthorization;
  resources: SCIMResource[];
}

export interface TenantProviderConfig {
  namespace: string;
  type: string;
  signatureField: string;
}

export type AuthServiceInput<
  User extends TailorDBType,
  AttributeMap extends UserAttributeMap<User>,
  AttributeList extends UserAttributeListKey<User>[],
> = {
  userProfile?: {
    type: User;
    usernameField: UsernameFieldKey<User>;
    attributes?: DisallowExtraKeys<AttributeMap, UserAttributeKey<User>>;
    attributeList?: AttributeList;
  };
  machineUsers?: Record<string, MachineUser<User, AttributeMap, AttributeList>>;
  oauth2Clients?: Record<string, OAuth2Client>;
  idProviderConfigs?: IdProviderConfig[];
  scimConfig?: SCIMConfig;
  tenantProviderConfig?: TenantProviderConfig;
};

export type AuthConfig = { name: string } & Omit<
  AuthServiceInput<TailorDBType, object, []>,
  "userProfile" | "machineUsers"
> & {
    userProfile?: {
      type: TailorDBType;
      usernameField: string;
      attributes?: Record<string, true>;
      attributeList?: string[];
    };
    machineUsers?: Record<
      string,
      {
        attributes?: Record<string, string | boolean | string[] | boolean[]>;
        attributeList?: string[];
      }
    >;
  };
