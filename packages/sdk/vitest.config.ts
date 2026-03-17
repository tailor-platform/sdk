import * as fs from "node:fs";
import * as path from "node:path";
import { defineConfig } from "vitest/config";

function yamlText() {
  return {
    name: "yaml-text",
    load(id: string) {
      if (id.endsWith(".yml") || id.endsWith(".yaml")) {
        const content = fs.readFileSync(id, "utf-8");
        return `export default ${JSON.stringify(content)};`;
      }
    },
  };
}

export default defineConfig({
  plugins: [yamlText()],
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
