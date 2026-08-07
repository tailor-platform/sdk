import { defineAuth, defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { user } from "./src/db/user";

export default defineConfig({
  name: "inventory-management",
  db: { "main-db": { files: [`./src/db/*.ts`] } },
  resolver: {
    "main-resolver": {
      files: ["./src/resolver/*.ts"],
      // Every resolver in this namespace requires an authenticated caller.
      // A single resolver opts out with `permission: "allowAnonymous"`.
      defaultPermission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    },
  },
  auth: defineAuth("main-auth", {
    userProfile: {
      type: user,
      usernameField: "email",
      attributes: {
        role: true,
      },
    },
    machineUsers: {
      manager: {
        attributes: { role: "MANAGER" },
      },
      staff: {
        attributes: { role: "STAFF" },
      },
    },
  }),
  executor: { files: ["./src/executor/*.ts"] },
});

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: `./src/generated/kysely-tailordb.ts` }),
);
