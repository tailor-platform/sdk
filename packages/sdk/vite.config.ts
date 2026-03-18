import * as path from "node:path";
import Sonda from "sonda/rolldown";
import { defineConfig } from "vite-plus";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

const yamlTextPlugin = { name: "yaml-text", load: loadYamlText } as const;

export default defineConfig({
  plugins: [yamlTextPlugin],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tailor-proto": path.resolve(__dirname, "../tailor-proto/src"),
    },
  },
  pack: {
    entry: [
      "src/configure/index.ts",
      "src/cli/index.ts",
      "src/cli/lib.ts",
      "src/cli/skills.ts",
      "src/utils/test/index.ts",
      "src/kysely/index.ts",
      "src/plugin/index.ts",
      "src/plugin/builtin/kysely-type/index.ts",
      "src/plugin/builtin/enum-constants/index.ts",
      "src/plugin/builtin/file-utils/index.ts",
      "src/plugin/builtin/seed/index.ts",
      "src/seed/index.ts",
    ],
    format: ["esm"],
    target: "node18",
    platform: "node",
    clean: true,
    dts: true,
    outDir: "dist",
    tsconfig: "./tsconfig.json",
    minify: false,
    outExtensions: () => ({
      js: ".mjs",
      dts: ".d.mts",
    }),
    sourcemap: true,
    plugins: [
      yamlTextPlugin,
      Sonda({
        open: false,
        format: "json",
        filename: "bundle-analysis.json",
        deep: true,
      }),
    ],
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
    // @vitest/coverage-v8 reports a version mismatch warning with the aliased vitest
    // (vite-plus-test). Coverage still works correctly but runs on an unsupported combination.
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
