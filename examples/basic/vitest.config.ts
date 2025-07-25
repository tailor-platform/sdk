import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.{test,spec}.ts"],
    globals: true,
    watch: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 60000,
    outputFile: { json: "tests/results.json" },
  },
});
