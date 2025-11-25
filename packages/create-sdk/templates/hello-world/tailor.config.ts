import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "hello-world",
  db: {
    tailordb: { external: true },
  },
  resolver: {
    "main-resolver": { files: [`./src/resolvers/**/*.ts`] },
    "my-resolver": { external: true },
  },
  idp: [{ name: "my-idp", external: true }],
  auth: { name: "my-auth", external: true },
});
