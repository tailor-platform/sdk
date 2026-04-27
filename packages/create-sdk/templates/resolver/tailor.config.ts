import { defineAuth, defineConfig, definePlugins, t } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export default defineConfig({
  name: "resolver",
  env: {
    appName: "Resolver Template",
    version: 1,
  },
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
    },
  }),
  db: { "main-db": { files: ["./src/db/*.ts"] } },
  resolver: { "main-resolver": { files: ["./src/resolver/*.ts"] } },
  executor: { files: ["./src/executor/*.ts"] },
});

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./src/generated/db.ts" }));
