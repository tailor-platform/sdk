import {
  defineAuth,
  defineConfig,
  defineGenerators,
} from "@tailor-platform/tailor-sdk";

export default defineConfig({
  name: "testing",
  auth: defineAuth("main-auth", {
    machineUsers: {
      admin: {
        attributes: {},
      },
    },
  }),
  db: { "main-db": { files: ["./src/db/*.ts"] } },
  resolver: { "main-resolver": { files: ["./src/resolver/*.ts"] } },
});

export const generators = defineGenerators([
  "@tailor/kysely-type",
  { distPath: "./src/generated/db.ts" },
]);
