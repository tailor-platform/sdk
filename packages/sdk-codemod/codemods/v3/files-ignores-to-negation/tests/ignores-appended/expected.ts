import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  executor: {
    files: [
      "executors/**/*.ts",
      "jobs/**/*.ts",
      "!executors/**/*.draft.ts",
      "!**/ci-only.ts",
    ],
  },
});
