import { defineConfig, defineAuth, defineIdp } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const idp = defineIdp("app-idp", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
});

const auth = defineAuth("app-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: {
      role: true,
    },
  },
  machineUsers: {
    "system-admin": {
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
    "web-client": {
      redirectURIs: ["http://localhost:3000/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("web-client", "default-idp-client"),
});

export default defineConfig({
  name: "challenge-034",
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  idp: [idp],
  auth,
});
