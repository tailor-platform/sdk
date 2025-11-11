import {
  defineAuth,
  defineConfig,
  defineGenerators,
  defineIdp,
  defineStaticWebSite,
} from "@tailor-platform/tailor-sdk";
import { gqlIngestGenerator } from "./generator/gql-ingest";
import { linesDbGenerator } from "./generator/lines-db";
import { user } from "./tailordb/user";

const website = defineStaticWebSite("my-frontend", {
  description: "my frontend application",
});

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
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
      redirectURIs: ["https://example.com/callback", `${website.url}/callback`],
      description: "Sample OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("sample", "default-idp-client"),
});

export default defineConfig({
  name: "my-app",
  cors: [
    website.url, // This will be replaced with the actual Static Website URL
  ],
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
      // Note: *.test.ts and *.spec.ts are automatically ignored by default
      // You can add additional ignore patterns if needed:
      // ignores: ["./tailordb/*.draft.ts"],
    },
  },
  resolver: {
    "my-resolver": { files: ["./resolvers/*.ts"] },
  },
  idp: [idp],
  auth,
  executor: { files: ["./executors/*.ts"] },
  staticWebsites: [website],
});

export const generators = defineGenerators(
  ["@tailor/kysely-type", { distPath: "./generated/tailordb.ts" }],
  ["@tailor/db-type", { distPath: "./generated/types.ts" }],
  gqlIngestGenerator,
  linesDbGenerator,
);
