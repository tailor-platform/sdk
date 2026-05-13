import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["core/**/*.test.ts", "problems/*/tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
