import { defineConfig } from "@tailor-platform/tailor-sdk";

export default defineConfig({
  name: "hello-world",
  resolver: { "main-resolver": { files: [`./src/resolvers/**/*.ts`] } },
});
