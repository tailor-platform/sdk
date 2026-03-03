import {
  defineAuth,
  defineConfig,
  defineGenerators,
  defineIdp,
  defineStaticWebSite,
} from "@tailor-platform/sdk";
import { member } from "./tailordb/member";

const dashboard = defineStaticWebSite("dashboard", {
  description: "Project management dashboard",
});

const idp = defineIdp("project-idp", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
  userAuthPolicy: {
    useNonEmailIdentifier: false,
    allowSelfPasswordReset: true,
    passwordRequireUppercase: true,
    passwordRequireLowercase: true,
    passwordRequireNumeric: true,
    passwordRequireNonAlphanumeric: true,
    passwordMinLength: 8,
    passwordMaxLength: 128,
  },
});

const auth = defineAuth("project-auth", {
  userProfile: {
    type: member,
    usernameField: "email",
    attributes: { role: true },
  },
  machineUsers: {
    SYSTEM_WORKER: {
      attributes: { role: "ADMIN" },
    },
    ADMIN_SERVICE: {
      attributes: { role: "OWNER" },
    },
  },
  oauth2Clients: {
    "dashboard-client": {
      redirectURIs: [`${dashboard.url}/callback`],
      description: "Dashboard OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("project-provider", "default-idp-client"),
});

export default defineConfig({
  name: "project-mgmt",
  cors: [dashboard.url],
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  auth,
  idp: [idp],
  staticWebsites: [dashboard],
});

export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./generated/tailordb.ts" }],
  ["@tailor-platform/seed", { distPath: "./seed", machineUserName: "ADMIN_SERVICE" }],
);
