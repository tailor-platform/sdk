import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  executor: {
    files: ["e2e/**/*.test.ts", "!e2e/skip.test.ts"],
  },
});
