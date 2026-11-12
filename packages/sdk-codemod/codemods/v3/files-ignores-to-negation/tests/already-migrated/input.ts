import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  executor: {
    files: ["executors/**/*.ts", "!executors/ci-only.ts", "!**/*.test.ts", "!**/*.spec.ts"],
  },
});
