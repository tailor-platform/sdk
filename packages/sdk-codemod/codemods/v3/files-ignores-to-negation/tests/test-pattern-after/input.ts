import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  executor: {
    files: [
      "executors/**/*.ts", // main
      "executors/**/*.test.ts",
    ],
  },
  workflow: {
    files: ["w/*.ts", "w/*.spec.ts", "!w/x.spec.ts"],
  },
});
