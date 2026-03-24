import { z } from "zod";

export const AuthConnectionOAuth2ConfigSchema = z.object({
  providerUrl: z.string().describe("OAuth2 provider URL"),
  issuerUrl: z.string().describe("OAuth2 issuer URL"),
  clientId: z.string().describe("OAuth2 client ID"),
  clientSecret: z.string().describe("OAuth2 client secret"),
  authUrl: z.string().optional().describe("OAuth2 authorization endpoint override"),
  tokenUrl: z.string().optional().describe("OAuth2 token endpoint override"),
});

export const AuthConnectionConfigSchema = z
  .object({
    type: z.literal("oauth2").describe("Connection type"),
  })
  .and(AuthConnectionOAuth2ConfigSchema);
