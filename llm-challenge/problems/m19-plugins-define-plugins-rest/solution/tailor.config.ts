import {
  defineAuth,
  defineConfig,
  definePlugins,
  defineStaticWebSite,
  t,
} from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";

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

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
  seedPlugin({ distPath: "./seed", machineUserName: "runner" }),
);
