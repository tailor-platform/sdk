import { defineConfig, defineAuth, defineGenerators } from "@tailor-platform/sdk";
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

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./generated/tailordb.ts" },
]);

export default defineConfig({
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
