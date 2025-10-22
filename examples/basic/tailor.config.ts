import {
  defineAuth,
  defineConfig,
  defineGenerators,
  defineStaticWebSite,
} from "@tailor-platform/tailor-sdk";
import { user } from "tailordb/user";

const website = defineStaticWebSite("my-frontend", {
  description: "my frontend application",
});

const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: {
      role: true,
    },
  },
  machineUsers: {
    "manager-machine-user": {
      attributes: {
        role: "MANAGER",
      },
    },
  },
  oauth2Clients: {
    sample: {
      redirectURIs: ["https://example.com/callback", website.callbackUrl],
      description: "Sample OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: {
    name: "sample",
    kind: "BuiltInIdP",
    namespace: "my-idp",
    clientName: "default-idp-client",
  },
});

export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  cors: [
    website.url, // This will be replaced with the actual Static Website URL
  ],
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  pipeline: {
    "my-pipeline": { files: ["./resolvers/**/resolver.ts"] },
  },
  idp: {
    "my-idp": {
      authorization: "loggedIn",
      clients: ["default-idp-client"],
    },
  },
  auth,
  executor: { files: ["./executors/*.ts"] },
  staticWebsites: [website],
});

export const generators = defineGenerators(
  ["@tailor/kysely-type", { distPath: "./generated/tailordb.ts" }],
  ["@tailor/db-type", { distPath: "./generated/types.ts" }],
);
