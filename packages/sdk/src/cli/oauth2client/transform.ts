import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  type AuthOAuth2Client,
  AuthOAuth2Client_GrantType,
} from "@tailor-proto/tailor/v1/auth_resource_pb";

export const grantTypeToString = (grantType: AuthOAuth2Client_GrantType): string => {
  switch (grantType) {
    case AuthOAuth2Client_GrantType.AUTHORIZATION_CODE:
      return "authorization_code";
    case AuthOAuth2Client_GrantType.REFRESH_TOKEN:
      return "refresh_token";
    default:
      return "unknown";
  }
};

export interface OAuth2ClientInfo {
  name: string;
  description: string;
  clientId: string;
  grantTypes: string[];
  redirectUris: string[];
  createdAt: string;
}

export interface OAuth2ClientCredentials {
  name: string;
  description: string;
  clientId: string;
  clientSecret: string;
  grantTypes: string[];
  redirectUris: string[];
  createdAt: string;
}

/**
 * Transform an AuthOAuth2Client into CLI-friendly OAuth2 client info.
 * @param {AuthOAuth2Client} client - OAuth2 client resource
 * @returns {OAuth2ClientInfo} Flattened OAuth2 client info
 */
export function toOAuth2ClientInfo(client: AuthOAuth2Client): OAuth2ClientInfo {
  return {
    name: client.name,
    description: client.description,
    clientId: client.clientId,
    grantTypes: client.grantTypes.map(grantTypeToString),
    redirectUris: client.redirectUris,
    createdAt: client.createdAt ? timestampDate(client.createdAt).toISOString() : "N/A",
  };
}

/**
 * Transform an AuthOAuth2Client into OAuth2 client credentials info.
 * @param {AuthOAuth2Client} client - OAuth2 client resource
 * @returns {OAuth2ClientCredentials} OAuth2 client credentials
 */
export function toOAuth2ClientCredentials(client: AuthOAuth2Client): OAuth2ClientCredentials {
  return {
    name: client.name,
    description: client.description,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    grantTypes: client.grantTypes.map(grantTypeToString),
    redirectUris: client.redirectUris,
    createdAt: client.createdAt ? timestampDate(client.createdAt).toISOString() : "N/A",
  };
}
