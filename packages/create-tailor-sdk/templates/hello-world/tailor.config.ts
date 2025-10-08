import { defineConfig } from "@tailor-platform/tailor-sdk";

export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "hello-world",
  pipeline: { "main-pipeline": { files: [`./src/resolvers/**/*.ts`] } },
});
