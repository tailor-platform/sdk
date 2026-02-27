import { defineAuth, defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { user } from "./src/db/user";

export default defineConfig({
  name: "inventory-management",
  db: { "main-db": { files: [`./src/db/*.ts`] } },
  resolver: { "main-resolver": { files: [`./src/resolver/*.ts`] } },
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
