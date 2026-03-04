import {
  defineAuth,
  defineConfig,
  defineGenerators,
  defineIdp,
  defineStaticWebSite,
} from "@tailor-platform/sdk";
import { registration } from "./tailordb/registration";

const website = defineStaticWebSite("registration-app", {
  description: "User registration frontend",
});

const idp = defineIdp("registration-idp", {
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

const auth = defineAuth("registration-auth", {
  userProfile: {
    type: registration,
    usernameField: "email",
    attributes: { role: true },
  },
  machineUsers: {
    "system-user": {
      attributes: { role: "admin" },
    },
  },
  oauth2Clients: {
    "registration-client": {
      redirectURIs: [`${website.url}/callback`, `${website.url}/auth/callback`],
      description: "Registration OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("registration-provider", "default-idp-client"),
});

export default defineConfig({
  name: "challenge-005",
  cors: [website.url],
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  resolver: {
    "my-resolver": {
      files: ["./resolvers/*.ts"],
    },
  },
  executor: {
    files: ["./executors/*.ts"],
  },
  workflow: {
    files: ["./workflows/**/*.ts"],
  },
  auth,
  idp: [idp],
  staticWebsites: [website],
});

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./generated/tailordb.ts" },
]);
