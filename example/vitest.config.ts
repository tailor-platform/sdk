import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    outputFile: { json: "tests/results.json" },
    projects: [
      {
        test: {
          name: { label: "generator", color: "blue" },
          environment: "node",
          include: ["tests/**/*.{test,spec}.ts"],
        },
      },
      {
        test: {
          name: { label: "e2e", color: "green" },
          environment: "node",
          include: ["e2e/**/*.{test,spec}.ts"],
          globalSetup: "e2e/globalSetup.ts",
          testTimeout: 60_000,
        },
      },
    ],
  },
});
