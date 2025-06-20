/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IdTokenConfig {
  Kind: "IDToken";
  ClientID: string;
  ProviderURL: string;
}

export interface IdProviderConfig {
  Name: string;
  Config: IdTokenConfig;
  IdTokenConfig?: IdTokenConfig; // manifest.sample2.jsonでは両方存在する場合がある
}

export interface UserProfileProviderConfig {
  Kind: "TAILORDB";
  Namespace: string;
  Type: string;
  UsernameField: string;
  AttributesFields: string[];
}

export interface MachineUser {
  Name: string;
  Attributes: string[];
}

export interface OAuth2Client {
  // TODO: OAuth2Clientの詳細な型定義が必要な場合は追加
  [key: string]: any;
}

export interface SCIMConfig {
  // TODO: SCIMConfigの詳細な型定義が必要な場合は追加
  [key: string]: any;
}

export interface TenantProviderConfig {
  // TODO: TenantProviderConfigの詳細な型定義が必要な場合は追加
  [key: string]: any;
}

export type UserProfileProvider = "TAILORDB" | string;
export type TenantProvider = "" | string;

export interface AuthServiceInput {
  namespace: string;
  idProviderConfigs?: IdProviderConfig[];
  userProfileProvider?: UserProfileProvider;
  userProfileProviderConfig?: UserProfileProviderConfig;
  scimConfig?: SCIMConfig | null;
  tenantProvider?: TenantProvider;
  tenantProviderConfig?: TenantProviderConfig | null;
  machineUsers?: MachineUser[];
  oauth2Clients?: OAuth2Client[];
  version?: string;
}

export interface AuthReference {
  Namespace: string;
  IdProviderConfigName: string;
}
