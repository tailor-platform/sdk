import {
  defineAuth,
  defineConfig,
  defineGenerators,
} from "@tailor-platform/sdk";

export default defineConfig({
  name: "testing",
  env: {
    foo: 1,
    bar: "hello",
    baz: true,
  },
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
  "@tailor-platform/kysely-type",
  { distPath: "./src/generated/db.ts" },
]);
