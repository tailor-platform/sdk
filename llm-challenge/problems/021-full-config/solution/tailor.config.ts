import { defineAuth, defineConfig, defineIdp, defineStaticWebSite } from "@tailor-platform/sdk";
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
  },
  oauth2Clients: {
    "web-app": {
      redirectURIs: ["http://localhost:3000/callback", `${website.url}/callback`],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("web-app", "default-idp-client"),
});

export default defineConfig({
  name: "challenge-021",
  cors: [website.url],
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  idp: [idp],
  auth,
  staticWebsites: [website],
});
