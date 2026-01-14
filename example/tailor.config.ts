import {
  defineAuth,
  defineConfig,
  defineGenerators,
  defineIdp,
  defineStaticWebSite,
} from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const website = defineStaticWebSite("my-frontend", {
  description: "my frontend application",
});

const erdSite = defineStaticWebSite("my-erd-site", {
  description: "ERD site for TailorDB",
});

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
  userAuthPolicy: {
    useNonEmailIdentifier: false,
    allowSelfPasswordReset: true,
    passwordRequireUppercase: true,
    passwordRequireLowercase: true,
    passwordRequireNonAlphanumeric: true,
    passwordRequireNumeric: true,
    passwordMinLength: 8,
    passwordMaxLength: 128,
  },
});

export const auth = defineAuth("my-auth", {
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
  env: {
    foo: 1,
    bar: "hello",
    baz: true,
  },
  cors: [
    website.url, // This will be replaced with the actual Static Website URL
  ],
  db: {
    tailordb: { files: ["./tailordb/*.ts"], erdSite: erdSite.name },
    analyticsdb: { files: ["./analyticsdb/*.ts"] },
  },
  resolver: {
    "my-resolver": { files: ["./resolvers/*.ts"] },
  },
  idp: [idp],
  auth,
  executor: { files: ["./executors/*.ts"] },
  workflow: {
    files: ["./workflows/**/*.ts"],
  },
  staticWebsites: [website],
});

export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./generated/tailordb.ts" }],
  ["@tailor-platform/enum-constants", { distPath: "./generated/enums.ts" }],
  ["@tailor-platform/file-utils", { distPath: "./generated/files.ts" }],
  ["@tailor-platform/seed", { distPath: "./seed", machineUserName: "manager-machine-user" }],
);
