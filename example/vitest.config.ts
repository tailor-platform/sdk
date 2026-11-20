import { tailorRuntime } from "@tailor-platform/sdk/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailorRuntime()],
  test: {
    watch: false,
    outputFile: { json: "tests/results.json" },
    projects: [
      {
        test: {
          name: { label: "generator", color: "blue" },
          environment: "tailor-runtime",
          include: ["tests/**/*.{test,spec}.ts", "migrations/**/*.test.ts"],
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
