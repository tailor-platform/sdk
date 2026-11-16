import { describe, expect, test } from "vitest";
import transform, {
  reviewFindings,
} from "../codemods/v3/files-ignores-to-negation/scripts/transform";

const IMPORT = 'import { defineConfig } from "@tailor-platform/sdk";\n';

const review = (body: string) => {
  const source = IMPORT + body;
  return {
    transformed: transform(source, "tailor.config.ts"),
    findings: reviewFindings(source, "tailor.config.ts", "tailor.config.ts"),
  };
};

describe("ignores -> files negation migration review", () => {
  test.each([
    [
      "a literal config",
      'executor: { files: ["executors/**/*.ts"], ignores: ["**/x.ts"] },',
      'executor: { files: ["executors/**/*.ts", "!**/x.ts"] },',
    ],
    [
      "a template-literal negation already in files",
      "executor: { files: [`e/**/*.ts`, `!**/*.test.ts`] },",
      'executor: { files: [`e/**/*.ts`, `!**/*.test.ts`, "!**/*.spec.ts"] },',
    ],
    [
      "template-literal ignores",
      'executor: { files: ["e/**/*.ts"], ignores: [`**/x.ts`] },',
      'executor: { files: ["e/**/*.ts", `!**/x.ts`] },',
    ],
    [
      "template-literal ignores already negated in files",
      'executor: { files: ["e/**/*.ts", `!**/x.ts`], ignores: [`**/x.ts`] },',
      'executor: { files: ["e/**/*.ts", `!**/x.ts`] },',
    ],
    [
      "a namespace with a computed key",
      'db: { [shared]: { files: ["db/*.ts"] } },',
      'db: { [shared]: { files: ["db/*.ts", "!**/*.test.ts", "!**/*.spec.ts"] } },',
    ],
  ])("rewrites %s and reports nothing left to review", (_name, service, rewritten) => {
    const { transformed, findings } = review(`export default defineConfig({\n  ${service}\n});\n`);

    expect(transformed).toContain(rewritten);
    expect(findings).toEqual([]);
  });

  test("leaves the result unchanged when run again on a migrated config", () => {
    const { transformed } = review(
      'export default defineConfig({\n  workflow: { files: ["workflows/**/*.ts"] },\n});\n',
    );

    expect(transform(transformed!, "tailor.config.ts")).toBeNull();
  });

  test("leaves the result unchanged when run again on a config with a test-file pattern", () => {
    const { transformed } = review(
      'export default defineConfig({\n  workflow: { files: ["w/*.ts", "w/*.test.ts"] },\n});\n',
    );

    expect(transformed).toContain(
      'files: ["w/*.ts", "!**/*.test.ts", "!**/*.spec.ts", "w/*.test.ts"]',
    );
    expect(transform(transformed!, "tailor.config.ts")).toBeNull();
  });

  test("treats a template literal ending in .test.ts as a test-file pattern", () => {
    const { transformed } = review(
      "export default defineConfig({\n  workflow: { files: [`w/*.ts`, `${dir}/*.test.ts`] },\n});\n",
    );

    expect(transformed).toContain(
      'files: [`w/*.ts`, "!**/*.test.ts", "!**/*.spec.ts", `${dir}/*.test.ts`]',
    );
  });

  test("treats a template literal starting with ! as a negation", () => {
    const { transformed } = review(
      'export default defineConfig({\n  workflow: { files: ["w/*.ts", "w/*.test.ts", `!${dir}/x.ts`] },\n});\n',
    );

    expect(transformed).toContain(
      'files: ["w/*.ts", "!**/*.test.ts", "!**/*.spec.ts", "w/*.test.ts", `!${dir}/x.ts`]',
    );
  });

  test.each([
    ["a test-file pattern", '"e2e/*.test.ts", "!e2e/skip.test.ts", "ex/*.ts"'],
    ["a test-file template literal", '`${dir}/*.spec.ts`, "ex/*.ts"'],
  ])("inserts the test-file exclusion but flags %s before another pattern", (_name, elements) => {
    const { transformed, findings } = review(
      `export default defineConfig({\n  executor: { files: [${elements}] },\n});\n`,
    );

    expect(transformed).toContain(`files: [${elements}, "!**/*.test.ts", "!**/*.spec.ts"]`);
    expect(findings).toEqual([
      expect.objectContaining({ message: expect.stringContaining("before another pattern") }),
    ]);
  });

  test.each([
    [
      "outside the config directory after another pattern",
      '"src/**/*.ts", "../shared/**/*.test.ts"',
      '"src/**/*.ts", "!**/*.test.ts", "!**/*.spec.ts", "../shared/**/*.test.ts"',
    ],
    [
      "outside the config directory before another pattern",
      '"../shared/**/*.test.ts", "src/**/*.ts"',
      '"../shared/**/*.test.ts", "src/**/*.ts", "!**/*.test.ts", "!**/*.spec.ts"',
    ],
    [
      "whose exclusion the config already has",
      '"e2e/*.test.ts", "src/**/*.ts", "!**/*.test.ts"',
      '"e2e/*.test.ts", "src/**/*.ts", "!**/*.spec.ts", "!**/*.test.ts"',
    ],
  ])(
    "does not flag a test-file pattern %s, which no inserted pattern excludes",
    (_name, elements, expected) => {
      const { transformed, findings } = review(
        `export default defineConfig({\n  executor: { files: [${elements}] },\n});\n`,
      );

      expect(transformed).toContain(`files: [${expected}]`);
      expect(findings).toEqual([]);
    },
  );

  test.each([
    [
      "a config passed as a variable",
      'const config = { executor: { files: ["e/**/*.ts"], ignores: [] } };\nexport default defineConfig(config);\n',
      "not an object literal",
    ],
    [
      "a config composed with a spread",
      "export default defineConfig({\n  ...base,\n});\n",
      "spread or computed key",
    ],
    [
      "a service passed as a variable",
      "export default defineConfig({\n  executor,\n});\n",
      "`executor` is not an object literal",
    ],
    [
      "a namespace config passed as a variable",
      "export default defineConfig({\n  db: { main: mainDb },\n});\n",
      "a `db` namespace is not written as an object literal",
    ],
    [
      "a namespace config with a computed key passed as a variable",
      "export default defineConfig({\n  db: { [shared]: sharedDb },\n});\n",
      "a `db` namespace is not written as an object literal",
    ],
    [
      "a service config composed with a spread",
      "export default defineConfig({\n  workflow: { ...workflowFiles },\n});\n",
      "workflow has a spread or computed key",
    ],
    [
      "files built outside the array literal",
      "export default defineConfig({\n  executor: { files: executorFiles, ignores: [] },\n});\n",
      "executor.files is not an array literal",
    ],
    [
      "ignores built from a variable",
      'export default defineConfig({\n  resolver: { main: { files: ["r/**/*.ts"], ignores: shared } },\n});\n',
      "resolver.main.ignores is not an array of string literals",
    ],
    [
      "ignores with a non-literal element",
      'export default defineConfig({\n  executor: { files: ["e/**/*.ts"], ignores: [`${dir}/*.ts`] },\n});\n',
      "executor.ignores is not an array of string literals",
    ],
  ])("leaves %s unchanged and flags it for review", (_name, body, reason) => {
    const { transformed, findings } = review(body);

    expect(transformed).toBeNull();
    expect(findings).toEqual([
      expect.objectContaining({ message: expect.stringContaining(reason) }),
    ]);
  });

  test.each([
    ["a pattern above the config directory", '"../shared/executors/**/*.ts"'],
    ["a pattern whose `..` leads above the config directory", '"src/../../shared/**/*.ts"'],
    ["a pattern above the config directory with backslashes", '"..\\\\shared\\\\**\\\\*.ts"'],
    ["an absolute pattern", '"/repo/shared/executors/**/*.ts"'],
    ["a pattern built from a variable", "sharedExecutors"],
    ["a template-literal pattern above the config directory", "`../shared/*.ts`"],
    ["a template-literal pattern with a substitution", "`${dir}/*.ts`"],
  ])("appends the test-file exclusion but flags %s, which it may not cover", (_name, element) => {
    const { transformed, findings } = review(
      `export default defineConfig({\n  executor: { files: [${element}] },\n});\n`,
    );

    expect(transformed).toContain(`files: [${element}, "!**/*.test.ts", "!**/*.spec.ts"]`);
    expect(findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("can match files outside this config's directory"),
      }),
    ]);
  });

  test.each([
    ["a pattern whose `..` stays inside the config directory", '"src/../executors/**/*.ts"'],
    ["a `!` pattern whose `..` leads above it", '"executors/**/*.ts", "!src/../../shared/x.ts"'],
    ["a template-literal pattern inside the config directory", "`executors/**/*.ts`"],
  ])("does not flag %s", (_name, elements) => {
    const { findings } = review(
      `export default defineConfig({\n  executor: { files: [${elements}] },\n});\n`,
    );

    expect(findings).toEqual([]);
  });

  test("labels a computed namespace key by its source text", () => {
    const { findings } = review(
      'export default defineConfig({\n  db: { [shared]: { files: ["../db/*.ts"] } },\n});\n',
    );

    expect(findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          "db[shared].files can match files outside this config's directory",
        ),
      }),
    ]);
  });
});
