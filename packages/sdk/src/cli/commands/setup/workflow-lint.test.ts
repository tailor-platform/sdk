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

  test("triggers on the erd command, example project, workflow file and its scripts for both push and pull_request", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content.match(/- example\/\*\*/g)?.length).toBe(2);
    expect(content.match(/- \.github\/scripts\/erd-\*\.mjs/g)?.length).toBe(2);
    expect(content.match(/- \.github\/workflows\/erd-schema\.yml/g)?.length).toBe(2);
  });

  test("uploads a per-namespace schema artifact on pushes to main", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("branches: [main]");
    expect(content).toContain("name: erd-schema-${{ matrix.namespace }}");
    expect(content).toContain("tailordb erd export --namespace");
    expect(content).toContain("if-no-files-found: ignore");
    expect(content).toContain("retention-days: 90");
  });

  test("fails loudly instead of silently uploading nothing when erd export produces no file", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(
      content.match(/ERD export for namespace '\$NAMESPACE' produced no output file/g)?.length,
    ).toBe(2);
    expect(content).toContain(
      'if [ ! -s "$RUNNER_TEMP/erd-export/$NAMESPACE/dist/index.html" ]; then',
    );
    expect(content).toContain(
      'if [ ! -s "$RUNNER_TEMP/erd-head/$NAMESPACE/dist/index.html" ]; then',
    );
  });

  test("delegates relevance filtering to erd-relevance.mjs in the preview job only, always uploading a successful export", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content.match(/run: node \.github\/scripts\/erd-relevance\.mjs/g)?.length).toBe(1);
    // Export job: uploads whenever the export itself succeeded, regardless of relevance,
    // so the preview job can pick any ancestor run as a base without checking which ones have it.
    expect(content).toContain(
      "- name: Upload ERD schema\n        if: steps.export.outputs.exported != 'false'\n",
    );
    // Preview job: always runs, since it must compute the fork point even when head is missing.
    expect(content).toContain(
      "id: relevance\n        env:\n          GH_TOKEN: ${{ github.token }}\n          REPO: ${{ github.repository }}\n          SHA_BASE: ${{ github.event.pull_request.base.sha }}",
    );
  });

  test("reuses the export job's recorded schema via erd-find-base-run.mjs instead of rebuilding the base side", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).not.toContain("name: Checkout base branch");
    expect(content).not.toContain("name: Install base deps");
    expect(content).not.toContain("pnpm install --frozen-lockfile");
    expect(content).toContain("run: node .github/scripts/erd-find-base-run.mjs");
    expect(content).toContain("gh run download");
    expect(content).toContain("actions: read # look up and download the export job's artifacts");
  });

  test("looks up the schema at the PR's actual fork point, not just base's moving tip", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("FORK_SHA: ${{ steps.relevance.outputs.fork_sha }}");
    expect(content).toContain(
      "if: steps.relevance.outputs.relevant != 'false' && steps.find-base-run.outputs.run_id != ''",
    );
  });

  test("searches the PR's actual base branch for export runs instead of assuming main", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("BASE_REF: ${{ github.event.pull_request.base.ref }}");
  });

  test("renders a diff even when no base schema export can be found", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain('base_missing="true"');
    expect(content).toContain("rendering current objects as added");
    expect(content).toContain('diff_args=(--namespace "$NAMESPACE"');
    expect(content).toContain('diff_args+=(--base-html "$RUNNER_TEMP/erd-base/index.html")');
    expect(content).toContain("pnpm exec tailor-sdk tailordb erd diff");
  });

  test("fails loudly instead of silently uploading nothing when a relevant diff render produces no file", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain('if [ ! -s "$RUNNER_TEMP/erd-preview/$NAMESPACE.html" ]; then');
    expect(content).toContain("ERD diff render for namespace '$NAMESPACE' produced no output file");
  });

  test("groups each job's concurrency so a fast-follow push/PR update cannot cancel or race a run", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("group: erd-schema-export-${{ github.sha }}");
    expect(content).toContain("cancel-in-progress: false");
    expect(content).toContain("group: erd-schema-preview-${{ github.ref }}");
    expect(content).toContain("cancel-in-progress: true");
  });

  test("uploads preview artifacts unzipped, with names matched by the sticky comment script", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("name: ${{ matrix.namespace }}.html");
    expect(content).toContain("archive: false");
    expect(content).toContain("retention-days: 7");
  });

  test("posts the sticky preview comment via erd-upsert-comment.mjs, skipping fork PRs", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    expect(content).toContain("run: node .github/scripts/erd-upsert-comment.mjs");
    expect(content).toContain("pull-requests: write # upsert the sticky preview comment");
    expect(content).toContain("RUN_ID: ${{ github.run_id }}");
  });

  test("checks out the repository in every job that runs an erd-*.mjs script", () => {
    const content = fs.readFileSync(ERD_SCHEMA_WORKFLOW, "utf-8");

    const jobBodies = content.split(/^ {2}[a-z]+:\n/m).slice(1);
    const scriptJobs = jobBodies.filter((job) => job.includes("run: node .github/scripts/erd-"));

    expect(scriptJobs.length).toBeGreaterThan(0);
    expect(scriptJobs.every((job) => job.includes("uses: actions/checkout@"))).toBe(true);
  });

  test.skipIf(!actionlintAvailable)("passes actionlint", () => {
    const { ok, output } = runActionlint(ERD_SCHEMA_WORKFLOW);
    expect(ok, `actionlint errors for ${ERD_SCHEMA_WORKFLOW}:\n${output}`).toBe(true);
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
    apps: [{ name: "api", dir: "." }],
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
