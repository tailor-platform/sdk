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
});

export default defineConfig({
  name: "my-app",
  inlineSourcemap: false,
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
