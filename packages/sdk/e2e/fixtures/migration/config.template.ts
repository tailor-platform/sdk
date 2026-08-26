import { defineConfig, defineAuth, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";
import { user } from "./tailordb/user";

const auth = defineAuth("migration-test-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: {
      role: true,
    },
  },
  machineUsers: {
    "migration-executor": {
      attributes: { role: "ADMIN" },
    },
  },
});

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
  seedPlugin({ distPath: "./seed", machineUserName: "migration-executor" }),
);

export default defineConfig({
  id: "dd52af75-a667-4751-806f-a6f3d16ee4c2",
  name: "{{APP_NAME}}",
  auth,
  db: {
    "{{TAILORDB_NAME}}": {
      files: ["./tailordb/*.ts"],
      migration: {
        directory: "./migrations",
        machineUser: "migration-executor",
      },
    },
  },
});
