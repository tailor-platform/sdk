/**
 * Actionlint validation for generated GitHub Actions workflows.
 *
 * Each rendered workflow is written to a temp directory and validated with
 * `actionlint`. The test suite is skipped when the `actionlint` binary is not
 * available on PATH (e.g. a machine without aqua installed), so it never
 * causes false negatives in environments that have not run `aqua i`.
 *
 * Locally: run `aqua i` first, then this suite will execute as normal tests.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { renderBranchWorkflow, renderTagWorkflow, type PackageManager } from "./templates";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isActionlintAvailable(): boolean {
  const result = spawnSync("actionlint", ["--version"], { encoding: "utf-8" });
  return result.status === 0;
}

type LintResult = { ok: boolean; output: string };

function runActionlint(workflowPath: string): LintResult {
  const result = spawnSync("actionlint", ["-color", workflowPath], {
    encoding: "utf-8",
  });
  const output = `${result.stdout}${result.stderr}`.trim();
  return { ok: result.status === 0, output };
}

// ---------------------------------------------------------------------------
// Fixture: temp directory for generated files
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-lint-"));
  fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
});

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Common params
// ---------------------------------------------------------------------------

const COMMON = {
  workspaceName: "my-app",
  environment: "my-app",
};

const ALL_PM: PackageManager[] = ["pnpm", "yarn", "npm", "bun"];
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const ERD_PREVIEW_WORKFLOW = path.join(REPO_ROOT, ".github/workflows/erd-viewer-preview.yml");

// Suites are skipped entirely when actionlint is not on PATH (run `aqua i` first).
const actionlintAvailable = isActionlintAvailable();

// ---------------------------------------------------------------------------
// Utility: write + lint a workflow
// ---------------------------------------------------------------------------

function writeAndLint(name: string, content: string): LintResult {
  const filePath = path.join(tmpDir, ".github", "workflows", `${name}.yml`);
  fs.writeFileSync(filePath, content, "utf-8");
  return runActionlint(filePath);
}

describe("repository ERD preview workflow", () => {
  test("installs base dependencies before exporting the base schema", () => {
    const content = fs.readFileSync(ERD_PREVIEW_WORKFLOW, "utf-8");
    const checkoutBase = content.indexOf("name: Checkout base branch");
    const installBase = content.indexOf("name: Install base deps");
    const baseExport = content.indexOf("cd .erd-base/example");

    expect(checkoutBase).toBeGreaterThanOrEqual(0);
    expect(installBase).toBeGreaterThan(checkoutBase);
    expect(installBase).toBeLessThan(baseExport);
    expect(content).toContain("working-directory: .erd-base");
    expect(content).toContain("pnpm install --frozen-lockfile");
  });

  test.skipIf(!actionlintAvailable)("passes actionlint", () => {
    const { ok, output } = runActionlint(ERD_PREVIEW_WORKFLOW);
    expect(ok, `actionlint errors for ${ERD_PREVIEW_WORKFLOW}:\n${output}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests (skipped when actionlint is not on PATH)
// ---------------------------------------------------------------------------

describe.skipIf(!actionlintAvailable)("actionlint validation of renderBranchWorkflow", () => {
  // All four package managers, plan=true, no optional fields
  for (const pm of ALL_PM) {
    test(`branch / ${pm} / plan=true / minimal`, () => {
      const { content } = renderBranchWorkflow({
        ...COMMON,
        branch: "main",
        packageManager: pm,
        plan: true,
        erdPreview: null,
      });
      const { ok, output } = writeAndLint(`branch-${pm}-plan`, content);
      expect(ok, `actionlint errors for branch/${pm}/plan=true:\n${output}`).toBe(true);
    });
  }

  // plan=false (drops plan job, pull_request trigger, dispatch inputs)
  for (const pm of ALL_PM) {
    test(`branch / ${pm} / plan=false / minimal`, () => {
      const { content } = renderBranchWorkflow({
        ...COMMON,
        branch: "main",
        packageManager: pm,
        plan: false,
        erdPreview: null,
      });
      const { ok, output } = writeAndLint(`branch-${pm}-noplan`, content);
      expect(ok, `actionlint errors for branch/${pm}/plan=false:\n${output}`).toBe(true);
    });
  }

  // workingDirectory: present
  test("branch / pnpm / plan=true / with workingDirectory", () => {
    const { content } = renderBranchWorkflow({
      ...COMMON,
      branch: "main",
      packageManager: "pnpm",
      plan: true,
      erdPreview: null,
      workingDirectory: "apps/backend",
    });
    const { ok, output } = writeAndLint("branch-pnpm-plan-dir", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });

  // explicit environment
  test("branch / pnpm / plan=true / with explicit environment", () => {
    const { content } = renderBranchWorkflow({
      ...COMMON,
      branch: "main",
      packageManager: "pnpm",
      plan: true,
      erdPreview: null,
      environment: "production",
    });
    const { ok, output } = writeAndLint("branch-pnpm-plan-env", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });

  test("branch / pnpm / plan=true / with ERD preview", () => {
    const { content } = renderBranchWorkflow({
      ...COMMON,
      branch: "main",
      packageManager: "pnpm",
      plan: true,
      erdPreview: { namespaces: ["tailordb", "analyticsdb"] },
    });
    const { ok, output } = writeAndLint("branch-pnpm-plan-erd-preview", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });

  // plan=false + workingDirectory + environment
  test("branch / npm / plan=false / with workingDirectory + environment", () => {
    const { content } = renderBranchWorkflow({
      ...COMMON,
      branch: "develop",
      packageManager: "npm",
      plan: false,
      erdPreview: null,
      workingDirectory: "apps/api",
      environment: "staging",
    });
    const { ok, output } = writeAndLint("branch-npm-noplan-dir-env", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });
});

describe.skipIf(!actionlintAvailable)("actionlint validation of renderTagWorkflow", () => {
  // All four package managers, no guard
  for (const pm of ALL_PM) {
    test(`tag / ${pm} / no guard / minimal`, () => {
      const { content } = renderTagWorkflow({ ...COMMON, tagPattern: "v*", packageManager: pm });
      const { ok, output } = writeAndLint(`tag-${pm}-noguard`, content);
      expect(ok, `actionlint errors for tag/${pm}/no-guard:\n${output}`).toBe(true);
    });
  }

  // All four package managers, with branch guard
  for (const pm of ALL_PM) {
    test(`tag / ${pm} / with branch guard`, () => {
      const { content } = renderTagWorkflow({
        ...COMMON,
        tagPattern: "v*",
        packageManager: pm,
        branch: "main",
      });
      const { ok, output } = writeAndLint(`tag-${pm}-guard`, content);
      expect(ok, `actionlint errors for tag/${pm}/guard:\n${output}`).toBe(true);
    });
  }

  // Custom tag pattern + workingDirectory + environment
  test("tag / pnpm / with guard + workingDirectory + environment", () => {
    const { content } = renderTagWorkflow({
      ...COMMON,
      tagPattern: "release-*",
      packageManager: "pnpm",
      branch: "main",
      workingDirectory: "apps/backend",
      environment: "production",
    });
    const { ok, output } = writeAndLint("tag-pnpm-guard-dir-env", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });

  // explicit environment, no guard
  test("tag / bun / no guard / with explicit environment", () => {
    const { content } = renderTagWorkflow({
      ...COMMON,
      tagPattern: "v*",
      packageManager: "bun",
      environment: "production",
    });
    const { ok, output } = writeAndLint("tag-bun-noguard-env", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });
});
