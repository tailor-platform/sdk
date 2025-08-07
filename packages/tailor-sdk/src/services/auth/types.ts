import { SecretValue } from "@/types/types";

export interface OIDC {
  Kind: "OIDC";
  ClientID: string;
  ClientSecret: SecretValue;
  ProviderURL: string;
  IssuerURL?: string;
  UsernameClaim?: string;
}

export interface SAML {
  Kind: "SAML";
  MetadataURL: string;
  SpCertBase64: SecretValue;
  SpKeyBase64: SecretValue;
}

export interface IDToken {
  Kind: "IDToken";
  ProviderURL: string;
  IssuerURL?: string;
  ClientID: string;
  UsernameClaim?: string;
}

export interface BuiltinIdP {
  Kind: "BuiltInIdP";
  Namespace: string;
  ClientName: string;
}

export interface IdProviderConfig {
  Name: string;
  Config: OIDC | SAML | IDToken | BuiltinIdP;
}

export interface UserProfileProviderConfig {
  Kind: "TAILORDB";
  Namespace: string;
  Type: string;
  UsernameField: string;
  TenantIdField?: string;
  AttributesFields: string[];
}

export interface MachineUser {
  Name: string;
  Attributes: string[];
}

export type OAuth2ClientGrantType = "authorization_code" | "refresh_token";

export interface OAuth2Client {
  Name: string;
  Description?: string;
  GrantTypes?: OAuth2ClientGrantType[];
  RedirectURIs: string[];
}

export interface SCIMAuthorization {
  Type: "oauth2" | "bearer";
  BearerSecret?: SecretValue;
}

export type SCIMAttributeType =
  | "string"
  | "number"
  | "boolean"
  | "datetime"
  | "complex";

export interface SCIMAttribute {
  Type: SCIMAttributeType;
  Name: string;
  Description?: string;
  Mutability?: "readOnly" | "readWrite" | "writeOnly";
  Required?: boolean;
  MultiValued?: boolean;
  Uniqueness?: "none" | "server" | "global";
  CanonicalValues?: string[] | null;
  SubAttributes?: SCIMAttribute[] | null;
}

export interface SCIMSchema {
  Name: string;
  Attributes: SCIMAttribute[];
}

export interface SCIMAttributeMapping {
  TailorDBField: string;
  SCIMPath: string;
}

export interface SCIMResource {
  Name: string;
  TailorDBNamespace: string;
  TailorDBType: string;
  CoreSchema: SCIMSchema;
  AttributeMapping: SCIMAttributeMapping[];
}

export interface SCIMConfig {
  MachineUserName: string;
  Authorization: SCIMAuthorization;
  Resources: SCIMResource[];
}

export interface TenantProviderConfig {
  Kind: "TAILORDB";
  Namespace: string;
  Type: string;
  SignatureField: string;
}

export type UserProfileProvider = "TAILORDB" | string;
export type TenantProvider = "" | string;

export interface AuthServiceInput {
  version?: string;
  namespace: string;
  idProviderConfigs?: IdProviderConfig[];
  userProfileProvider?: UserProfileProvider;
  userProfileProviderConfig?: UserProfileProviderConfig | null;
  scimConfig?: SCIMConfig | null;
  tenantProvider?: TenantProvider;
  tenantProviderConfig?: TenantProviderConfig | null;
  machineUsers?: MachineUser[];
  oauth2Clients?: OAuth2Client[];
}

export interface AuthReference {
  Namespace: string;
  IdProviderConfigName?: string;
}
