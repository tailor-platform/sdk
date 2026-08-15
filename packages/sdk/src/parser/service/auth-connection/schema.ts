import * as v from "valibot";

export const AuthConnectionOAuth2ConfigSchema = v.strictObject({
  providerUrl: v.pipe(v.string(), v.description("OAuth2 provider URL")),
  issuerUrl: v.pipe(v.string(), v.description("OAuth2 issuer URL")),
  clientId: v.pipe(v.string(), v.description("OAuth2 client ID")),
  clientSecret: v.pipe(v.string(), v.description("OAuth2 client secret")),
  authUrl: v.optional(v.pipe(v.string(), v.description("OAuth2 authorization endpoint override"))),
  tokenUrl: v.optional(v.pipe(v.string(), v.description("OAuth2 token endpoint override"))),
});

export const AuthConnectionConfigSchema = v.strictObject({
  ...AuthConnectionOAuth2ConfigSchema.entries,
  type: v.pipe(v.literal("oauth2"), v.description("Connection type")),
});
