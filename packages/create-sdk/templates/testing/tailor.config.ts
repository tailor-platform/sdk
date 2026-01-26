import { defineAuth, defineConfig, defineGenerators, t } from "@tailor-platform/sdk";

export default defineConfig({
  name: "testing",
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
  workflow: { files: ["./src/workflow/*.ts"] },
});

export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./src/generated/db.ts" },
]);
