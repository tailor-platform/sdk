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
});

export default defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
  auth,
  staticWebsites: [website],
});

// Register kyselyTypePlugin and seedPlugin in one call here.
// Use the rest-args plugin registration function exported from
// `@tailor-platform/sdk`. See problem.md for the full requirements.
