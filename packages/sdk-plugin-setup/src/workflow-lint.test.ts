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
import * as path from "node:path";
import { aroundAll, describe, expect, test } from "vitest";
import {
  renderBranchWorkflow,
  renderCoordinateWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
  type PackageManager,
} from "./templates";
import { tempDir } from "./test-helpers/temp-dir";

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

aroundAll(async (runSuite) => {
  using tmp = tempDir("workflow-lint-");
  tmpDir = tmp.dir;
  fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
  await runSuite();
});

const COMMON = {
  workspaceName: "my-app",
  environment: "my-app",
};

const ALL_PM: PackageManager[] = ["pnpm", "yarn", "npm", "bun"];
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const ERD_SCHEMA_WORKFLOW = path.join(REPO_ROOT, ".github/workflows/erd-schema.yml");

// Suites are skipped entirely when actionlint is not on PATH (run `aqua i` first).
const actionlintAvailable = isActionlintAvailable();

function writeAndLint(name: string, content: string): LintResult {
  const filePath = path.join(tmpDir, ".github", "workflows", `${name}.yml`);
  fs.writeFileSync(filePath, content, "utf-8");
  return runActionlint(filePath);
}

describe("repository ERD schema workflow", () => {
  test("gates the export and preview jobs by event type in a single workflow file", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("if: github.event_name == 'push'");
    expect(content).toContain("if: github.event_name == 'pull_request'");
    expect(content).toContain(
      "if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository",
    );
  });

  test("triggers on the example project and the workflow file for both push and pull_request", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content.match(/- example\/\*\*/g)?.length).toBe(2);
    expect(content.match(/- \.github\/workflows\/erd-schema\.yml/g)?.length).toBe(2);
  });

  test("delegates to the shared tailor-platform/actions ERD building blocks instead of in-repo scripts", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toMatch(/uses: tailor-platform\/actions\/erd-schema-export@[0-9a-f]{40} # v\d/);
    expect(content).toMatch(
      /uses: tailor-platform\/actions\/erd-schema-preview@[0-9a-f]{40} # v\d/,
    );
    expect(content).toMatch(
      /uses: tailor-platform\/actions\/erd-schema-comment@[0-9a-f]{40} # v\d/,
    );
    expect(content).not.toContain(".github/scripts/erd-");
  });

  test("exports on push to main, uploading a per-namespace artifact for the preview job to reuse", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("branches: [main]");
    expect(content).toContain("artifact-name: erd-schema-${{ matrix.namespace }}");
    expect(content).toContain('retention-days: "90"');
  });

  test("previews on pull_request at the PR's true fork point via base-ref/sha-base/sha-head", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("sha-base: ${{ github.event.pull_request.base.sha }}");
    expect(content).toContain("sha-head: ${{ github.event.pull_request.head.sha }}");
    expect(content).toContain("base-ref: ${{ github.event.pull_request.base.ref }}");
    expect(content).toContain("export-workflow-file: erd-schema.yml");
    expect(content).toContain("base-artifact-name: erd-schema-${{ matrix.namespace }}");
    expect(content).toContain("preview-artifact-name: ${{ matrix.namespace }}.html");
  });

  test("passes both the static config path and the erd viewer implementation as always-relevant", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("example/tailor.config.ts");
    expect(content).toContain("packages/sdk-plugin-tailordb-erd/");
    expect(content).toContain("relevant-path-prefix: example/");
  });

  test("groups each job's concurrency per commit/ref and per namespace so matrix entries run in parallel without racing each other", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    const exportJob = content.slice(
      content.indexOf("\n  export:"),
      content.indexOf("\n  preview:"),
    );
    const previewJob = content.slice(
      content.indexOf("\n  preview:"),
      content.indexOf("\n  comment:"),
    );
    const commentJob = content.slice(content.indexOf("\n  comment:"));

    expect(exportJob).toContain(
      "group: erd-schema-export-${{ github.sha }}-${{ matrix.namespace }}",
    );
    expect(exportJob).toContain("cancel-in-progress: false");

    expect(previewJob).toContain(
      "group: erd-schema-preview-${{ github.ref }}-${{ matrix.namespace }}",
    );
    expect(previewJob).toContain("cancel-in-progress: true");

    expect(commentJob).toContain("group: erd-schema-comment-${{ github.ref }}");
    expect(commentJob).toContain("cancel-in-progress: true");
  });

  test("grants actions:read for the base-run lookup and pull-requests:write for the comment", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("actions: read # look up and download the export job's artifacts");
    expect(content).toContain("pull-requests: write # upsert the sticky preview comment");
    expect(content).toContain("actions: read # required to list the run's artifacts");
  });

  test("posts the sticky preview comment once per PR, skipping fork PRs", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("needs: preview");
    expect(content).toContain("pr-number: ${{ github.event.pull_request.number }}");
  });

  test("checks out the repository before every tailor-platform/actions/erd-schema-* step", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    const jobBodies = content.split(/^ {2}[a-zA-Z_][a-zA-Z0-9_-]*:\n/m).slice(1);
    const actionJobs = jobBodies.filter((job) =>
      job.includes("tailor-platform/actions/erd-schema-"),
    );

    expect(actionJobs.length).toBe(3);
    expect(actionJobs.every((job) => job.includes("uses: actions/checkout@"))).toBe(true);
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

  // seed validation + workingDirectory + environment
  test("branch / npm / with seed validation + workingDirectory + environment", () => {
    const { content } = renderBranchWorkflow({
      ...COMMON,
      branch: "develop",
      packageManager: "npm",
      erdPreview: null,
      seedValidate: true,
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
      name: "tag / pnpm / with guard + seed validation + workingDirectory + environment",
      fileName: "tag-pnpm-guard-dir-env",
      params: {
        tagPattern: "release-*",
        packageManager: "pnpm" as const,
        branch: "main",
        seedValidate: true,
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

  aroundAll(async (runSuite) => {
    using tmp = tempDir("coord-lint-");
    cTmpDir = tmp.dir;
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
    await runSuite();
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
