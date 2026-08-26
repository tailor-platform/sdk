import { defineAuth, defineConfig, definePlugins, t } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export default defineConfig({
  name: "workflow",
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
  resolver: {
    "main-resolver": {
      files: ["./src/resolver/*.ts"],
      // Every resolver in this namespace requires an authenticated caller.
      // A single resolver opts out with `permission: "allowAnonymous"`.
      defaultPermission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    },
  },
  workflow: { files: ["./src/workflow/*.ts"] },
});

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./src/generated/db.ts" }));
