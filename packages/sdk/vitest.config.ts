import { globSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { defineConfig } from "vitest/config";
import { loadYamlText } from "./scripts/yaml-text-plugin.mjs";

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

// Shared with the "integration" project definition below.
const integrationTestIncludes = [
  "src/cli/commands/deploy/__test_fixtures__/**/*.test.ts",
  "src/plugin/compat.test.ts",
];

// Split unit tests by whether they mutate worker-global state. With
// `isolate: false` a worker shares one module registry and one global object
// across files, so per-file partial module mocks (e.g. `vi.mock("node:fs", ...)`)
// collide between files, and fake timers (`vi.useFakeTimers`) left installed by
// one file stall real-time waits in the next. Tests doing either keep per-file
// isolation; the rest reuse module evaluation across files, which roughly
// halves their import time.
// Classification is by file content so new tests are routed automatically.
const classifyUnitTests = (): { isolated: string[]; shared: string[] } => {
  const integrationTestFiles = new Set(globSync(integrationTestIncludes, { cwd: __dirname }));
  const isExcludedUnitTest = (file: string): boolean =>
    file.includes("/node_modules/") ||
    file.includes("/__test_fixtures__/") ||
    integrationTestFiles.has(file) ||
    // Self-contained nested vitest project with its own config.
    file.startsWith("src/vitest/integration/");

  const needsIsolation = (file: string): boolean =>
    /\bvi\.(mock|doMock|useFakeTimers)\s*\(/.test(
      readFileSync(path.resolve(__dirname, file), "utf8"),
    );

  const isolated: string[] = [];
  const shared: string[] = [];
  for (const file of globSync(["src/**/*.{test,spec}.ts", "scripts/**/*.{test,spec}.ts"], {
    cwd: __dirname,
  })) {
    if (isExcludedUnitTest(file)) continue;
    (needsIsolation(file) ? isolated : shared).push(file);
  }
  return { isolated, shared };
};

// This config module is re-evaluated once per `extends: true` project (each in
// the same process), so cache the file scan on globalThis to run it only once.
const globalCache = globalThis as { __sdkUnitTestSplit?: ReturnType<typeof classifyUnitTests> };
const { isolated: isolatedUnitTests, shared: sharedUnitTests } = (globalCache.__sdkUnitTestSplit ??=
  classifyUnitTests());

export default defineConfig({
  plugins: [{ name: "yaml-text", load: loadYamlText }],
  resolve: {
    alias: [
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
          // Tests that mutate worker-global state keep per-file isolation
          // (see split above).
          // Type tests (`*.test-d.ts`) are collected via `typecheck.include`
          // independently of `include`; disable here so they run only once
          // (in "unit-core").
          name: "unit",
          include: isolatedUnitTests,
          typecheck: { enabled: false },
        },
      },
      {
        extends: true,
        test: {
          // The remaining tests share module evaluation across files
          // (isolate:false) to cut module-import time. Safe because no
          // `vi.mock`/`vi.useFakeTimers` is involved.
          name: "unit-core",
          isolate: false,
          include: sharedUnitTests,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: integrationTestIncludes,
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
