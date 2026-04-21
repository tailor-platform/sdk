import { defineAuth, defineConfig, defineIdp, defineStaticWebSite } from "@tailor-platform/sdk";
import { user } from "./src/db/user";

const website = defineStaticWebSite("my-frontend", {
  description: "Frontend application with login",
});

const idp = defineIdp("my-idp", {
  clients: ["default-idp-client"],
  permission: {
    create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    read: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    update: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
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
    admin: {
      attributes: {
        role: "ADMIN",
      },
    },
  },
  oauth2Clients: {
    "web-client": {
      redirectURIs: [`${website.url}/callback.html`],
      description: "Web application OAuth2 client",
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("web-provider", "default-idp-client"),
});

export default defineConfig({
  name: "static-web-site",
  cors: [website.url],
  db: { "main-db": { files: ["./src/db/*.ts"] } },
  idp: [idp],
  auth,
  staticWebsites: [website],
});
