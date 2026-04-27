import { defineConfig } from "vitest/config";
import { tailorRuntime } from "@tailor-platform/sdk/vitest";

export default defineConfig({
  plugins: [tailorRuntime()],
  test: {
    watch: false,
    projects: [
      {
        test: {
          name: { label: "unit", color: "blue" },
          environment: "tailor-runtime",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: { label: "e2e", color: "green" },
          include: ["e2e/**/*.test.ts"],
          globalSetup: "e2e/globalSetup.ts",
        },
      },
    ],
  },
});
