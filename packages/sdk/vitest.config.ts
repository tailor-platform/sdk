import * as path from "node:path";
import { defineConfig } from "vitest/config";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

const srcDir = path.resolve(__dirname, "./src");
const protoDir = path.resolve(__dirname, "../tailor-proto/src");

const sdkSourceEntrypoints = [
  ["", "configure/index.ts"],
  ["cli", "cli/lib.ts"],
  ["test", "utils/test/index.ts"],
  ["kysely", "kysely/index.ts"],
  ["plugin", "plugin/index.ts"],
  ["plugin/kysely-type", "plugin/builtin/kysely-type/index.ts"],
  ["plugin/enum-constants", "plugin/builtin/enum-constants/index.ts"],
  ["plugin/file-utils", "plugin/builtin/file-utils/index.ts"],
  ["plugin/seed", "plugin/builtin/seed/index.ts"],
  ["seed", "seed/index.ts"],
  ["vitest", "vitest/index.ts"],
  ["vitest/environment", "vitest/environment.ts"],
  ["runtime", "runtime/index.ts"],
  ["runtime/globals", "runtime/globals.ts"],
  ["runtime/iconv", "runtime/iconv.ts"],
  ["runtime/secretmanager", "runtime/secretmanager.ts"],
  ["runtime/authconnection", "runtime/authconnection.ts"],
  ["runtime/idp", "runtime/idp.ts"],
  ["runtime/workflow", "runtime/workflow.ts"],
  ["runtime/context", "runtime/context.ts"],
  ["runtime/file", "runtime/file.ts"],
] as const;

const sdkSourceAliases = sdkSourceEntrypoints.map(([subpath, sourcePath]) => ({
  find: new RegExp(`^@tailor-platform\\/sdk${subpath ? `\\/${subpath}` : ""}$`),
  replacement: path.join(srcDir, sourcePath),
}));

export default defineConfig({
  plugins: [{ name: "yaml-text", load: loadYamlText }],
  resolve: {
    alias: [
      { find: /^@(?=\/|$)/, replacement: srcDir },
      { find: /^@tailor-proto(?=\/|$)/, replacement: protoDir },
      // Keep package self-imports on the source tree so V8 coverage does not
      // remap built package exports and direct source imports as separate files.
      ...sdkSourceAliases,
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/?(*.)+(spec|test).ts"],
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "e2e/**",
            "**/__test_fixtures__/**",
            "src/plugin/compat.test.ts",
            "src/vitest/integration/**",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [
            "src/cli/commands/deploy/__test_fixtures__/**/*.test.ts",
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
      {
        test: {
          name: "scripts",
          include: ["../../scripts/**/*.test.js"],
          typecheck: { enabled: false },
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
