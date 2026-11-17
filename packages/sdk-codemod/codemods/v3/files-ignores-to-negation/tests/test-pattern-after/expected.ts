import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  executor: {
    files: [
      "executors/**/*.ts", // main
      "!**/*.test.ts",
      "!**/*.spec.ts",
      "executors/**/*.test.ts",
    ],
  },
  workflow: {
    files: ["w/*.ts", "!**/*.test.ts", "!**/*.spec.ts", "w/*.spec.ts", "!w/x.spec.ts"],
  },
});
