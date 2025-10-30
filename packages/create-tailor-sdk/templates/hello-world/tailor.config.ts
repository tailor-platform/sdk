import { defineConfig } from "@tailor-platform/tailor-sdk";

export default defineConfig({
  name: "hello-world",
  pipeline: { "main-pipeline": { files: [`./src/resolvers/**/*.ts`] } },
});
