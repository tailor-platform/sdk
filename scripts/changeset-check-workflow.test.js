import { existsSync, readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { describe, expect, test } from "vitest";

const workflowLines = readFileSync(
  new URL("../.github/workflows/changeset-check.yml", import.meta.url),
  "utf8",
).split("\n");

function filterPatterns(name) {
  const start = workflowLines.indexOf(`            ${name}:`);
  if (start < 0) throw new Error(`filter "${name}" not found in changeset-check.yml`);
  const patterns = [];
  for (const line of workflowLines.slice(start + 1)) {
    const pattern = /^ {14}- '(.+)'$/.exec(line);
    if (!pattern) break;
    patterns.push(pattern[1]);
  }
  return patterns;
}

function stepCondition(name) {
  const start = workflowLines.indexOf(`      - name: ${name}`);
  if (start < 0) throw new Error(`step "${name}" not found in changeset-check.yml`);
  const condition = [];
  for (const line of workflowLines.slice(start + 1)) {
    if (/^ {8}if: >-$/.test(line)) continue;
    if (!/^ {10}\S/.test(line)) break;
    condition.push(line.trim());
  }
  return condition.join(" ");
}

// dorny/paths-filter with `predicate-quantifier: some-with-excludes`: a file matches when it
// matches an include and no `!` exclude. The paths below avoid dotfiles and case variants, where
// node:path matchesGlob and paths-filter's picomatch differ.
function matchesFilter(patterns, file) {
  const excludes = patterns.filter((pattern) => pattern.startsWith("!"));
  const includes = patterns.filter((pattern) => !pattern.startsWith("!"));
  return (
    includes.some((pattern) => matchesGlob(file, pattern)) &&
    !excludes.some((pattern) => matchesGlob(file, pattern.slice(1)))
  );
}

describe("changeset-check workflow", () => {
  const packageSource = filterPatterns("package_source");

  test.each([
    "packages/sdk/src/cli/shared/logger.ts",
    "packages/sdk/src/utils/test/index.ts",
    "packages/sdk/src/vitest/index.ts",
    "packages/sdk/postinstall.mjs",
    "packages/sdk/bin/tailor.mjs",
    "packages/create-sdk/src/index.ts",
    "packages/create-sdk/templates/workflow/e2e/workflow.test.ts",
    "packages/sdk-plugin-setup/src/autofix.workflow.yml",
    "packages/sdk-plugin-seed/bin/cli.mjs",
    "packages/eslint-plugin-sdk/src/rules/no-job-start-outside-body.ts",
    "packages/sdk-plugin-tailordb-erd/src/cli.ts",
    "packages/sdk-plugin-frontend/src/index.ts",
    "packages/tailor-proto/src/tailor/v1/service_pb.js",
  ])("requires a changeset for %s, which a package ships", (file) => {
    expect(matchesFilter(packageSource, file)).toBe(true);
  });

  test.each([
    "packages/sdk/src/cli/shared/logger.test.ts",
    "packages/sdk/src/cli/commands/deploy/compare.test-d.ts",
    "packages/sdk/src/cli/shared/test-helpers/temp-dir.ts",
    "packages/eslint-plugin-sdk/src/rules/test-helpers.ts",
    "packages/sdk/src/cli/commands/deploy/__test_fixtures__/prepare.ts",
    "packages/sdk-plugin-seed/src/__fixtures__/seed-target.ts",
    "packages/sdk/src/vitest/integration/vitest.config.ts",
    "packages/sdk/scripts/build-entries.mjs",
    "packages/sdk/e2e/deploy.test.ts",
    "packages/sdk/package.json",
    "packages/sdk-codemod/src/registry.ts",
    "scripts/pkg-pr-new-workflow.test.js",
  ])("leaves %s to the skip-changeset label or another check", (file) => {
    expect(matchesFilter(packageSource, file)).toBe(false);
  });

  test.each(
    filterPatterns("packages")
      .map((pattern) => /^packages\/([^/*]+)\/\*\*$/.exec(pattern)?.[1])
      .filter((name) => name !== undefined && name !== "sdk-codemod"),
  )("covers the source and bin of packages/%s, which the packages filter lists", (name) => {
    const shipped = [
      `packages/${name}/src/index.ts`,
      ...(existsSync(new URL(`../packages/${name}/bin`, import.meta.url))
        ? [`packages/${name}/bin/cli.mjs`]
        : []),
    ];
    expect(shipped.filter((file) => !matchesFilter(packageSource, file))).toEqual([]);
  });

  test("fails a PR that changes package source without a changeset, whatever its labels", () => {
    expect(stepCondition("Fail if package source changes without a changeset")).toBe(
      "steps.filter.outputs.package_source == 'true' && steps.filter.outputs.changeset != 'true'",
    );
  });
});
