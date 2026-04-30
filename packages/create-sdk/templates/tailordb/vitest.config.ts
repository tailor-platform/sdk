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
    ],
  },
});
