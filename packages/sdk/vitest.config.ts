import { globSync, readFileSync } from "node:fs";
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

// Split unit tests by whether they mock modules (`vi.mock`/`vi.doMock`). With
// `isolate: false` a worker shares one module registry across files, so per-file
// partial module mocks (e.g. `vi.mock("node:fs", ...)`) collide between files.
// Tests that mock modules therefore keep per-file isolation; the rest reuse
// module evaluation across files, which roughly halves their import time.
// Classification is by file content so new tests are routed automatically.
const isExcludedUnitTest = (file: string): boolean =>
  file.includes("/__test_fixtures__/") ||
  file === "src/plugin/compat.test.ts" ||
  file.startsWith("src/vitest/integration/");

const mocksModules = (file: string): boolean =>
  /\bvi\.(mock|doMock)\s*\(/.test(readFileSync(path.resolve(__dirname, file), "utf8"));

const unitTestFiles = globSync(
  ["src/**/*.test.ts", "src/**/*.spec.ts", "scripts/**/*.test.ts", "scripts/**/*.spec.ts"],
  { cwd: __dirname },
)
  .filter((file) => !isExcludedUnitTest(file))
  .sort();

const isolatedUnitTests: string[] = [];
const sharedUnitTests: string[] = [];
for (const file of unitTestFiles) {
  (mocksModules(file) ? isolatedUnitTests : sharedUnitTests).push(file);
}

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
          // Tests that mock modules keep per-file isolation (see split above).
          // The only `*.test-d.ts` type test is mock-free and runs in
          // "unit-core", so typecheck has nothing to collect here.
          name: "unit",
          include: isolatedUnitTests,
          typecheck: { enabled: false },
        },
      },
      {
        extends: true,
        test: {
          // Mock-free tests share module evaluation across files (isolate:false)
          // to cut module-import time. Safe because no `vi.mock` is involved.
          name: "unit-core",
          isolate: false,
          include: sharedUnitTests,
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
