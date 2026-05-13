import { defineAuth, defineConfig, defineStaticWebSite, t } from "@tailor-platform/sdk";

const website = defineStaticWebSite("my-frontend", {
  description: "Frontend SPA",
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
    web: {
      redirectURIs: [`${website.url}/callback`],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
});

export default defineConfig({
  name: "micro-challenge",
  cors: [website.url],
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  auth,
  staticWebsites: [website],
});
