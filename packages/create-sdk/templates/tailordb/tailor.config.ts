import { defineAuth, defineConfig, definePlugins, t } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export default defineConfig({
  name: "tailordb",
  auth: defineAuth("main-auth", {
    machineUserAttributes: {
      role: t.string(),
    },
    machineUsers: {
      admin: {
        attributes: {
          role: "admin",
        },
      },
      viewer: {
        attributes: {
          role: "viewer",
        },
      },
    },
  }),
  db: { "main-db": { files: ["./src/db/*.ts"] } },
});

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./src/generated/db.ts" }));
