import { tailorRuntime } from "@tailor-platform/sdk/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailorRuntime()],
  test: {
    watch: false,
    outputFile: { json: "tests/results.json" },
    // Disable inline sourcemaps during tests to keep bundled output stable
    // for size and fixture comparisons.
    env: {
      TAILOR_ENABLE_INLINE_SOURCEMAP: "false",
    },
    projects: [
      {
        test: {
          name: { label: "generator", color: "blue" },
          environment: "tailor-runtime",
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
