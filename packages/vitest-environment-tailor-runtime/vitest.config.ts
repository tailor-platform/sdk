import { defineConfig } from "vitest/config";
import { tailorRuntime } from "@tailor-platform/sdk/vitest";

export default defineConfig({
  plugins: [tailorRuntime()],
  test: {
    watch: false,
    // Use path instead of name to avoid self-referencing resolution issue
    // (this package IS vitest-environment-tailor-runtime)
    environment: "./index.js",
    include: ["__tests__/**/*.test.ts"],
  },
});
