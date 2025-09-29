import { defineConfig } from "@tailor-platform/tailor-sdk";

export default defineConfig({
  id: process.env.WORKSPACE_ID!,
  app: {
    "hello-world": {
      pipeline: {
        "main-pipeline": {
          files: [`./src/resolvers/**/*.ts`],
        },
      },
    },
  },
});
