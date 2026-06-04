import { readFileSync } from "node:fs";
import * as path from "node:path";
import { defineConfig } from "vitest/config";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

const srcDir = path.resolve(__dirname, "./src");
const protoDir = path.resolve(__dirname, "../tailor-proto/src");

type PackageExport = {
  import?: string;
  default?: string;
};

const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as {
  exports: Record<string, PackageExport>;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sdkSourceAliases = Object.entries(packageJson.exports).map(([exportName, target]) => {
  const publicImport =
    exportName === "." ? "@tailor-platform/sdk" : `@tailor-platform/sdk/${exportName.slice(2)}`;
  const distImport = target.import ?? target.default;

  if (!distImport?.startsWith("./dist/") || !distImport.endsWith(".mjs")) {
    throw new Error(
      `Unsupported @tailor-platform/sdk export ${exportName}: expected ./dist/*.mjs import target`,
    );
  }

  return {
    find: new RegExp(`^${escapeRegExp(publicImport)}$`),
    replacement: path.resolve(
      __dirname,
      distImport
        .replace(/^\.\//, "")
        .replace(/^dist\//, "src/")
        .replace(/\.mjs$/, ".ts"),
    ),
  };
});

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
