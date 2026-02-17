import {
  defineAuth,
  defineConfig,
  defineGenerators,
  defineIdp,
  defineStaticWebSite,
} from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const website = defineStaticWebSite("my-frontend", {
  description: "Frontend application",
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
    "admin-machine-user": {
      attributes: {
        role: "admin",
      },
    },
    "batch-worker": {
      attributes: {
        role: "editor",
      },
    },
  },
  oauth2Clients: {
    "web-app": {
      redirectURIs: [`${website.url}/callback`],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("web-app", "default-idp-client"),
});

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./generated/db.ts" },
]);

export default defineConfig({
  name: "challenge-008",
  cors: [website.url],
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  idp: [idp],
  auth,
  staticWebsites: [website],
});
