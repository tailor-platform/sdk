import { defineConfig } from "vitest/config";
import { tailorRuntime, tailorRuntimeEnvironment } from "@tailor-platform/sdk/vitest";

export default defineConfig({
  plugins: [tailorRuntime()],
  test: {
    watch: false,
    projects: [
      {
        test: {
          name: { label: "unit", color: "blue" },
          environment: tailorRuntimeEnvironment,
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: { label: "bundled", color: "yellow" },
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
  },
});
