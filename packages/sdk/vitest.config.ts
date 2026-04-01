import * as path from "node:path";
import { defineConfig } from "vitest/config";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

export default defineConfig({
  plugins: [{ name: "yaml-text", load: loadYamlText }],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tailor-proto": path.resolve(__dirname, "../tailor-proto/src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "e2e/**",
            "**/__test_fixtures__/**",
            "**/__tests__/fixtures/**",
            "src/plugin/compat.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [
            "src/cli/commands/apply/__test_fixtures__/**/*.test.ts",
            "src/plugin/compat.test.ts",
          ],
          testTimeout: 60000,
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["e2e/**/*.test.ts"],
          testTimeout: 120000,
          hookTimeout: 120000,
          globalSetup: ["e2e/globalSetup.ts"],
        },
      },
    ],
    environment: "node",
    globals: true,
    watch: false,
    typecheck: { enabled: true },
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
