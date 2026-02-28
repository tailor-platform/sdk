import {
  defineAuth,
  defineConfig,
  defineGenerators,
  defineIdp,
  defineStaticWebSite,
} from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const dashboard = defineStaticWebSite("dashboard", {
  description: "Main dashboard application",
});

const docs = defineStaticWebSite("docs-site", {
  description: "Documentation site",
});

const idp = defineIdp("saas-idp", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
  userAuthPolicy: {
    useNonEmailIdentifier: false,
    allowSelfPasswordReset: true,
    passwordRequireUppercase: true,
    passwordRequireLowercase: true,
    passwordRequireNonAlphanumeric: true,
    passwordRequireNumeric: true,
    passwordMinLength: 10,
    passwordMaxLength: 128,
  },
});

const auth = defineAuth("saas-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: { role: true },
  },
  machineUsers: {
    "admin-machine-user": {
      attributes: { role: "ADMIN" },
    },
    "worker-machine-user": {
      attributes: { role: "WORKER" },
    },
    "readonly-machine-user": {
      attributes: { role: "READONLY" },
    },
  },
  oauth2Clients: {
    "dashboard-client": {
      redirectURIs: [`${dashboard.url}/callback`, `${dashboard.url}/auth/redirect`],
      description: "Dashboard OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
    "docs-client": {
      redirectURIs: [`${docs.url}/callback`],
      description: "Documentation OAuth2 client",
      grantTypes: ["authorization_code"],
    },
  },
  idProvider: idp.provider("main-provider", "default-idp-client"),
});

export default defineConfig({
  name: "challenge-007",
  cors: [dashboard.url, docs.url],
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
  staticWebsites: [dashboard, docs],
});

export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./generated/tailordb.ts" }],
  [
    "@tailor-platform/seed",
    {
      distPath: "./seed",
      machineUserName: "admin-machine-user",
    },
  ],
);
