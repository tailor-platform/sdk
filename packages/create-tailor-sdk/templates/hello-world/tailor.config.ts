import { defineConfig } from "@tailor-platform/tailor-sdk";

if (!process.env.WORKSPACE_ID) {
  throw new Error("WORKSPACE_ID environment variable is not set");
}

export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID,
  name: "hello-world",
  pipeline: { "main-pipeline": { files: [`./src/resolvers/**/*.ts`] } },
});
