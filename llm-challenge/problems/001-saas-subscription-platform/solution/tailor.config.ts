import {
  defineAuth,
  defineConfig,
  defineGenerators,
  defineIdp,
  defineStaticWebSite,
} from "@tailor-platform/sdk";
import { organization } from "./tailordb/organization";

const dashboard = defineStaticWebSite("dashboard", {
  description: "SaaS management dashboard",
});

const idp = defineIdp("saas-idp", {
  clients: ["default-idp-client"],
  permission: {
    create: [{ conditions: [[{ user: "plan" }, "=", "ENTERPRISE"]], permit: true }],
    read: [{ conditions: [[{ user: "plan" }, "=", "ENTERPRISE"]], permit: true }],
    update: [{ conditions: [[{ user: "plan" }, "=", "ENTERPRISE"]], permit: true }],
    delete: [{ conditions: [[{ user: "plan" }, "=", "ENTERPRISE"]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
  },
  userAuthPolicy: {
    useNonEmailIdentifier: false,
    allowSelfPasswordReset: true,
    passwordRequireUppercase: true,
    passwordRequireLowercase: true,
    passwordRequireNumeric: true,
    passwordRequireNonAlphanumeric: true,
    passwordMinLength: 10,
    passwordMaxLength: 256,
  },
});

const auth = defineAuth("saas-auth", {
  userProfile: {
    type: organization,
    usernameField: "contactEmail",
    attributes: { plan: true },
  },
  machineUsers: {
    BILLING_WORKER: {
      attributes: { plan: "STARTER" },
    },
    ADMIN_SERVICE: {
      attributes: { plan: "ENTERPRISE" },
    },
    ANALYTICS: {
      attributes: { plan: "FREE" },
    },
  },
  oauth2Clients: {
    "dashboard-client": {
      redirectURIs: [`${dashboard.url}/callback`, `${dashboard.url}/auth/callback`],
      description: "Dashboard OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
    "api-client": {
      redirectURIs: ["https://api.example.com/callback"],
      description: "API OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("saas-provider", "default-idp-client"),
});

export default defineConfig({
  name: "saas-platform",
  cors: [dashboard.url],
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  resolver: {
    "saas-resolver": {
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
  staticWebsites: [dashboard],
});

export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./generated/tailordb.ts" }],
  ["@tailor-platform/seed", { distPath: "./seed", machineUserName: "ADMIN_SERVICE" }],
);
