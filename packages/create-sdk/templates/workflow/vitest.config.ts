import { defineConfig } from "vitest/config";
import { tailorRuntime } from "@tailor-platform/sdk/vitest";

export default defineConfig({
  plugins: [tailorRuntime()],
  test: {
    watch: false,
    projects: [
      {
        extends: true,
        test: {
          name: { label: "unit", color: "blue" },
          environment: "tailor-runtime",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: { label: "e2e", color: "green" },
          include: ["e2e/**/*.test.ts"],
          globalSetup: "e2e/globalSetup.ts",
          testTimeout: 60_000,
        },
      },
    ],
  },
});
