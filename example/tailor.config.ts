import {
  defineAuth,
  defineConfig,
  defineIdp,
  definePlugins,
  defineStaticWebSite,
} from "@tailor-platform/sdk";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { fileUtilsPlugin } from "@tailor-platform/sdk/plugin/file-utils";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";
import { user } from "./tailordb/user";

const website = defineStaticWebSite("my-frontend", {
  description: "my frontend application",
});

const erdSite = defineStaticWebSite("my-erd-site", {
  description: "ERD site for TailorDB",
});

const idp = defineIdp("my-idp", {
  clients: ["default-idp-client"],
  permission: {
    create: [{ conditions: [[{ user: "role" }, "=", "MANAGER"]], permit: true }],
    read: [{ conditions: [[{ user: "role" }, "=", "MANAGER"]], permit: true }],
    update: [{ conditions: [[{ user: "role" }, "=", "MANAGER"]], permit: true }],
    delete: [{ conditions: [[{ user: "role" }, "=", "MANAGER"]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
  },
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
  emailConfig: {
    fromName: "My App",
    passwordResetSubject: "Reset your password",
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
  hooks: {
    beforeLogin: {
      handler: async ({ claims, idpConfigName }) => {
        // Example before login hook implementation
        console.log("Before login hook triggered with claims:", claims);
        console.log("IDP Config Name:", idpConfigName);
        // You can perform additional checks or modifications to claims here
      },
      invoker: "manager-machine-user",
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
  // connections: {
  //   "google-connection": {
  //     type: "oauth2",
  //     providerUrl: "https://accounts.google.com",
  //     issuerUrl: "https://accounts.google.com",
  //     clientId: process.env.GOOGLE_CLIENT_ID!,
  //     clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  //   },
  // },
});

export default defineConfig({
  id: "d0a3398a-f79c-4c2e-be1e-b81469bb0a43",
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
    tailordb: {
      files: ["./tailordb/*.ts"],
      erdSite: erdSite.name,
      migration: {
        directory: "./migrations",
      },
    },
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
  staticWebsites: [website, erdSite],
});

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
  enumConstantsPlugin({ distPath: "./generated/enums.ts" }),
  fileUtilsPlugin({ distPath: "./generated/files.ts" }),
  seedPlugin({ distPath: "./seed", machineUserName: "manager-machine-user" }),
);
