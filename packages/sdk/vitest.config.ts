import { existsSync, globSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

type PackageExport = {
  import?: string;
  default?: string;
};

const packageJson = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8"),
) as {
  exports: Record<string, PackageExport>;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sdkSourceAliases = Object.entries(packageJson.exports)
  .filter(([, target]) => target.import ?? target.default)
  .map(([exportName, target]) => {
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
        import.meta.dirname,
        distImport
          .replace(/^\.\//, "")
          .replace(/^dist\//, "src/")
          .replace(/\.mjs$/, ".ts"),
      ),
    };
  });

// The e2e CLI helper's own tests need no workspace, so they run with the unit
// tests instead of the e2e project.
const e2eHelperTestIncludes = ["e2e/cli.test.ts"];

// Shared with the "integration" project definition below.
const integrationTestIncludes = [
  "src/cli/commands/deploy/__test_fixtures__/**/*.test.ts",
  "src/plugin/compat.test.ts",
];

// Tests whose behavior differs on Windows get their own project ("unit-windows",
// which the `unit*` glob still picks up on Linux) that the Windows CI job runs
// via `--project unit-windows` — no separator-sensitive path filter needed.
// Excluded from the general unit split below so they do not run twice.
const windowsTestIncludes = [
  "src/cli/shared/plugin.test.ts",
  "src/cli/shared/shell-quote.test.ts",
  "src/cli/shared/test-helpers/temp-cwd.test.ts",
  "src/cli/shared/test-helpers/temp-dir.test.ts",
];

const missingWindowsTests = windowsTestIncludes.filter(
  (file) => !existsSync(path.resolve(import.meta.dirname, file)),
);
if (missingWindowsTests.length > 0) {
  throw new Error(`windowsTestIncludes lists missing files: ${missingWindowsTests.join(", ")}`);
}

// Split unit tests by whether they mutate worker-global state. With
// `isolate: false` a worker shares one module registry and one global object
// across files, so per-file partial module mocks (e.g. `vi.mock("node:fs", ...)`)
// collide between files, and fake timers (`vi.useFakeTimers`) left installed by
// one file stall real-time waits in the next. Tests doing either keep per-file
// isolation; the rest reuse module evaluation across files, which roughly
// halves their import time.
// Classification is by file content so new tests are routed automatically.
const classifyUnitTests = (): { isolated: string[]; shared: string[] } => {
  const integrationTestFiles = new Set(
    globSync(integrationTestIncludes, { cwd: import.meta.dirname }),
  );
  const isExcludedUnitTest = (file: string): boolean =>
    file.includes("/node_modules/") ||
    file.includes("/__test_fixtures__/") ||
    integrationTestFiles.has(file) ||
    windowsTestIncludes.includes(file) ||
    // Self-contained nested vitest project with its own config.
    file.startsWith("src/vitest/integration/");

  const needsIsolation = (file: string): boolean =>
    /\bvi\.(mock|doMock|useFakeTimers)\s*\(/.test(
      readFileSync(path.resolve(import.meta.dirname, file), "utf8"),
    );

  const isolated: string[] = [];
  const shared: string[] = [];
  for (const file of globSync(
    ["src/**/*.{test,spec}.ts", "scripts/**/*.{test,spec}.ts", ...e2eHelperTestIncludes],
    { cwd: import.meta.dirname },
  )) {
    if (isExcludedUnitTest(file)) continue;
    (needsIsolation(file) ? isolated : shared).push(file);
  }
  return { isolated, shared };
};

const { isolated: isolatedUnitTests, shared: sharedUnitTests } = classifyUnitTests();

export default defineConfig({
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
        test: {
          // Tests that mutate worker-global state keep per-file isolation
          // (see split above).
          // Type tests (`*.test-d.ts`) are collected via `typecheck.include`
          // independently of `include`; disable here so they run only once
          // (in "unit-core").
          name: "unit",
          include: isolatedUnitTests,
          setupFiles: ["./vitest.setup.ts"],
          typecheck: { enabled: false },
        },
      },
      {
        test: {
          // The remaining tests share module evaluation across files
          // (isolate:false) to cut module-import time. Safe because no
          // `vi.mock`/`vi.useFakeTimers` is involved.
          name: "unit-core",
          isolate: false,
          include: sharedUnitTests,
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        test: {
          name: "unit-windows",
          include: windowsTestIncludes,
          setupFiles: ["./vitest.setup.ts"],
          typecheck: { enabled: false },
        },
      },
      {
        test: {
          name: "integration",
          include: integrationTestIncludes,
          setupFiles: ["./vitest.setup.ts"],
          testTimeout: 60000,
          typecheck: { enabled: false },
        },
      },
      {
        test: {
          name: "e2e",
          include: ["e2e/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...e2eHelperTestIncludes],
          testTimeout: 120000,
          hookTimeout: 300000,
          maxWorkers: 8,
          // Vitest rejects projects that differ in maxWorkers but share a groupOrder.
          sequence: { groupOrder: 1 },
          globalSetup: ["e2e/globalSetup.ts"],
          // CLI subprocesses keep human-readable output when the suite runs inside an AI coding agent.
          env: { POLITTY_NO_AGENT: "1" },
          typecheck: { enabled: false },
        },
      },
      {
        test: {
          name: "scripts",
          include: ["../../scripts/**/*.test.js"],
          setupFiles: ["./vitest.setup.ts"],
          typecheck: { enabled: false },
        },
      },
    ],
    environment: "node",
    clearMocks: true,
    globals: true,
    watch: false,
    // The dedicated tsconfig narrows tsc to the type-test files and their
    // imports; the full-project surface is already covered by `pnpm typecheck`.
    // Keep `include` and the tsconfig's `include` covering the same files so
    // every collected type test is actually compiled.
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.vitest-typecheck.json",
      include: ["src/**/*.{test,spec}-d.ts"],
    },
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
