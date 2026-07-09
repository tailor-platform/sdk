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
import {
  renderBranchWorkflow,
  renderCoordinateWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
  type PackageManager,
} from "./templates";

function isActionlintAvailable(): boolean {
  const result = spawnSync("actionlint", ["--version"], {
    encoding: "utf-8",
    timeout: 5000,
    killSignal: "SIGKILL",
  });
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

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-lint-"));
  fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
});

afterAll(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const COMMON = {
  workspaceName: "my-app",
  environment: "my-app",
};

const ALL_PM: PackageManager[] = ["pnpm", "yarn", "npm", "bun"];
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const ERD_PREVIEW_WORKFLOW = path.join(REPO_ROOT, ".github/workflows/erd-viewer-preview.yml");

// Suites are skipped entirely when actionlint is not on PATH (run `aqua i` first).
const actionlintAvailable = isActionlintAvailable();

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
    expect(content).toContain("pnpm --filter @tailor-platform/sdk run build");
  });

  test("renders a diff when the base namespace is missing", () => {
    const content = fs.readFileSync(ERD_PREVIEW_WORKFLOW, "utf-8");

    expect(content).toContain('base_missing="false"');
    expect(content).toContain("grep -q 'not found in local config.db'");
    expect(content).toContain("Base ERD namespace '$NAMESPACE' not found");
    expect(content).toContain('diff_args=(--namespace "$NAMESPACE"');
    expect(content).toContain('diff_args+=(--base-html "$base_html")');
    expect(content).toContain("pnpm exec tailor-sdk tailordb erd diff");
  });

  test("uploads artifacts with names matched by the sticky comment", () => {
    const content = fs.readFileSync(ERD_PREVIEW_WORKFLOW, "utf-8");

    expect(content).toContain("name: ${{ matrix.namespace }}.html");
    expect(content).not.toContain("name: ${{ matrix.namespace }}-diff.html");
    expect(content).toContain('select(.name | endswith(".html"))');
    expect(content).toContain("can switch between the current schema and a diff");
    expect(content).not.toContain("name: erd-viewer-preview-${{ matrix.namespace }}");
    expect(content).not.toContain("name: erd-viewer-diff-${{ matrix.namespace }}");
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
  // All four package managers, no optional fields
  for (const pm of ALL_PM) {
    test(`branch / ${pm} / minimal`, () => {
      const { content } = renderBranchWorkflow({
        ...COMMON,
        branch: "main",
        packageManager: pm,
        erdPreview: null,
      });
      const { ok, output } = writeAndLint(`branch-${pm}`, content);
      expect(ok, `actionlint errors for branch/${pm}:\n${output}`).toBe(true);
    });
  }

  // workingDirectory: present
  test("branch / pnpm / with workingDirectory", () => {
    const { content } = renderBranchWorkflow({
      ...COMMON,
      branch: "main",
      packageManager: "pnpm",
      erdPreview: null,
      workingDirectory: "apps/backend",
    });
    const { ok, output } = writeAndLint("branch-pnpm-dir", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });

  // explicit environment
  test("branch / pnpm / with explicit environment", () => {
    const { content } = renderBranchWorkflow({
      ...COMMON,
      branch: "main",
      packageManager: "pnpm",
      erdPreview: null,
      environment: "production",
    });
    const { ok, output } = writeAndLint("branch-pnpm-env", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });

  test("branch / pnpm / with ERD preview", () => {
    const { content } = renderBranchWorkflow({
      ...COMMON,
      branch: "main",
      packageManager: "pnpm",
      erdPreview: { namespaces: ["tailordb", "analyticsdb"] },
    });
    const { ok, output } = writeAndLint("branch-pnpm-erd-preview", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });

  // workingDirectory + environment
  test("branch / npm / with workingDirectory + environment", () => {
    const { content } = renderBranchWorkflow({
      ...COMMON,
      branch: "develop",
      packageManager: "npm",
      erdPreview: null,
      workingDirectory: "apps/api",
      environment: "staging",
    });
    const { ok, output } = writeAndLint("branch-npm-dir-env", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });
});

describe.skipIf(!actionlintAvailable)("actionlint validation of renderTagWorkflow", () => {
  const cases = [
    ...ALL_PM.map((pm) => ({
      name: `tag / ${pm} / no guard / minimal`,
      fileName: `tag-${pm}-noguard`,
      params: { tagPattern: "v*", packageManager: pm },
    })),
    ...ALL_PM.map((pm) => ({
      name: `tag / ${pm} / with branch guard`,
      fileName: `tag-${pm}-guard`,
      params: { tagPattern: "v*", packageManager: pm, branch: "main" },
    })),
    {
      name: "tag / pnpm / with guard + workingDirectory + environment",
      fileName: "tag-pnpm-guard-dir-env",
      params: {
        tagPattern: "release-*",
        packageManager: "pnpm" as const,
        branch: "main",
        workingDirectory: "apps/backend",
        environment: "production",
      },
    },
    {
      name: "tag / bun / no guard / with explicit environment",
      fileName: "tag-bun-noguard-env",
      params: { tagPattern: "v*", packageManager: "bun" as const, environment: "production" },
    },
  ];

  test.each(cases)("$name", ({ fileName, params }) => {
    const { content } = renderTagWorkflow({ ...COMMON, ...params });
    const { ok, output } = writeAndLint(fileName, content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });
});

// Minimal composite action stub used by coordinate workflow tests.
const COMPOSITE_ACTION_STUB = `\
name: stub
description: stub
inputs:
  workspace-id:
    required: true
  name:
    required: true
  working-directory:
    required: false
    default: "."
  package-manager:
    required: false
    default: pnpm
  platform-client-id:
    required: true
  platform-client-secret:
    required: true
  slack-token:
    required: false
  slack-channel-id:
    required: false
  user-mapping:
    required: false
outputs:
  app-url:
    description: stub
    value: ""
runs:
  using: composite
  steps:
    - run: echo stub
      shell: bash
`;

describe.skipIf(!actionlintAvailable)("actionlint validation of renderCoordinateWorkflow", () => {
  let cTmpDir: string;

  beforeAll(() => {
    cTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coord-lint-"));
    fs.mkdirSync(path.join(cTmpDir, ".github", "workflows"), { recursive: true });
    fs.mkdirSync(path.join(cTmpDir, ".github", "actions", "tailor-setup"), { recursive: true });
    fs.mkdirSync(path.join(cTmpDir, ".github", "actions", "tailor-api"), { recursive: true });
    // Use an inline stub instead of renderTailorSetupAction output to avoid
    // remote action references (tailor-platform/actions/setup@...) that would
    // cause actionlint to perform network lookups and hang in offline CI.
    fs.writeFileSync(
      path.join(cTmpDir, ".github", "actions", "tailor-setup", "action.yml"),
      "name: stub-setup\ndescription: stub\nruns:\n  using: composite\n  steps:\n    - run: echo stub\n      shell: bash\n",
    );
    fs.writeFileSync(
      path.join(cTmpDir, ".github", "actions", "tailor-api", "action.yml"),
      COMPOSITE_ACTION_STUB,
    );
  });

  afterAll(() => {
    if (cTmpDir) fs.rmSync(cTmpDir, { recursive: true, force: true });
  });

  function lintCoordinate(name: string, content: string): LintResult {
    const wfPath = path.join(cTmpDir, ".github", "workflows", `${name}.yml`);
    fs.writeFileSync(wfPath, content);
    // Run from REPO_ROOT (the sdk repo root) rather than from cTmpDir so that
    // the aqua proxy resolves actionlint from the project's aqua.yaml rather
    // than from a temp dir that has no aqua config.  Local uses: references
    // (./.github/actions/...) will not resolve from REPO_ROOT but we ignore
    // those errors so actionlint still validates the workflow structure.
    const result = spawnSync(
      "actionlint",
      ["-color", "-ignore", "action ./.github/actions/tailor-[^ ]+ is not found", wfPath],
      {
        encoding: "utf-8",
        cwd: REPO_ROOT,
        timeout: 15000,
        killSignal: "SIGKILL",
      },
    );
    const output = `${result.stdout}${result.stderr}`.trim();
    return { ok: result.status === 0, output };
  }

  const COORD_COMMON = {
    coordinatorName: "main",
    actionGroups: [{ id: "api", apps: [{ name: "api", dir: "." }] }],
    environment: "production",
    packageManager: "pnpm" as PackageManager,
  };

  test("coordinate / branch", () => {
    const { content } = renderCoordinateWorkflow({
      ...COORD_COMMON,
      kind: "branch",
      branch: "main",
    });
    const { ok, output } = lintCoordinate("coord-branch", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });

  test("coordinate / tag", () => {
    const { content } = renderCoordinateWorkflow({
      ...COORD_COMMON,
      kind: "tag",
      branch: "main",
      tagPattern: "v*",
    });
    const { ok, output } = lintCoordinate("coord-tag", content);
    expect(ok, `actionlint errors:\n${output}`).toBe(true);
  });
});

describe.skipIf(!actionlintAvailable)("actionlint validation of renderPreviewWorkflow", () => {
  const PREVIEW_COMMON = {
    ...COMMON,
    branch: "main",
    region: "us-west",
    packageManager: "pnpm" as PackageManager,
  };

  test("preview / pnpm / all PRs", () => {
    const { content } = renderPreviewWorkflow({ ...PREVIEW_COMMON, requirePreviewLabel: false });
    const { ok, output } = writeAndLint("preview-pnpm-all", content);
    expect(ok, `actionlint errors for preview/pnpm/all-prs:\n${output}`).toBe(true);
  });

  test("preview / pnpm / label-triggered", () => {
    const { content } = renderPreviewWorkflow({ ...PREVIEW_COMMON, requirePreviewLabel: true });
    const { ok, output } = writeAndLint("preview-pnpm-label", content);
    expect(ok, `actionlint errors for preview/pnpm/label-triggered:\n${output}`).toBe(true);
  });

  test("preview / pnpm / with workingDirectory", () => {
    const { content } = renderPreviewWorkflow({
      ...PREVIEW_COMMON,
      workingDirectory: "apps/backend",
    });
    const { ok, output } = writeAndLint("preview-pnpm-dir", content);
    expect(ok, `actionlint errors for preview/pnpm/workingDirectory:\n${output}`).toBe(true);
  });
});
