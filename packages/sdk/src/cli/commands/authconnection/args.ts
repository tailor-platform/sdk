import { arg } from "politty";
import { z } from "zod";

/**
 * Arguments for identifying an auth connection
 */
export const connectionNameArgs = {
  name: arg(z.string(), {
    alias: "n",
    description: "Auth connection name",
  }),
};

/**
 * Arguments for creating an OAuth2 auth connection
 */
export const oauth2ConnectionArgs = {
  ...connectionNameArgs,
  "provider-url": arg(z.string(), {
    description: "OAuth2 provider URL",
  }),
  "issuer-url": arg(z.string().optional(), {
    description: "OAuth2 issuer URL",
  }),
  "client-id": arg(z.string(), {
    description: "OAuth2 client ID",
  }),
  "client-secret": arg(z.string(), {
    description: "OAuth2 client secret",
  }),
  "auth-url": arg(z.string().optional(), {
    description: "OAuth2 authorization endpoint override",
  }),
  "token-url": arg(z.string().optional(), {
    description: "OAuth2 token endpoint override",
  }),
};
