import { defineAuth, defineConfig, defineStaticWebSite, t } from "@tailor-platform/sdk";

const adminSite = defineStaticWebSite("admin-frontend", {
  description: "Internal admin SPA",
});

const publicSite = defineStaticWebSite("public-frontend", {
  description: "Public-facing SPA",
});

export const auth = defineAuth("my-auth", {
  machineUserAttributes: {
    role: t.string(),
  },
  machineUsers: {
    runner: {
      attributes: {
        role: "RUNNER",
      },
    },
  },
  oauth2Clients: {
    admin: {
      redirectURIs: [`${adminSite.url}/callback`],
      grantTypes: ["authorization_code", "refresh_token"],
    },
    public: {
      redirectURIs: [`${publicSite.url}/callback`],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
});

export default defineConfig({
  name: "micro-challenge",
  cors: [adminSite.url, publicSite.url],
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  auth,
  staticWebsites: [adminSite, publicSite],
});
