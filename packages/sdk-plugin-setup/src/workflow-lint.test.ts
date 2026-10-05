/**
 * zizmor audit of generated GitHub Actions workflows and composite actions.
 *
 * Each rendered file is written to a temp directory and audited with
 * `zizmor --offline`. The audit suites are skipped when the `zizmor` binary is
 * not on PATH (e.g. a machine that has not run `aqua i`).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { aroundAll, describe, expect, test } from "vitest";
import {
  renderActionWorkflow,
  renderBranchWorkflow,
  renderCoordinateWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
  renderTailorSetupAction,
  type PackageManager,
} from "./templates";
import { tempDir } from "./test-helpers/temp-dir";

function isZizmorAvailable(): boolean {
  const result = spawnSync("zizmor", ["--version"], {
    encoding: "utf-8",
    timeout: 5000,
    killSignal: "SIGKILL",
  });
  return result.status === 0;
}

type AuditResult = { ok: boolean; output: string };

function runZizmor(filePath: string): AuditResult {
  const result = spawnSync(
    "zizmor",
    ["--offline", "--no-progress", "--format", "plain", filePath],
    {
      encoding: "utf-8",
      timeout: 30000,
      killSignal: "SIGKILL",
    },
  );
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

const zizmorAvailable = isZizmorAvailable();

function writeAndAudit(name: string, content: string): AuditResult {
  const filePath = path.join(tmpDir, ".github", "workflows", `${name}.yml`);
  fs.writeFileSync(filePath, content, "utf-8");
  return runZizmor(filePath);
}

function writeAndAuditAction(name: string, content: string): AuditResult {
  const dir = path.join(tmpDir, ".github", "actions", name);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "action.yml");
  fs.writeFileSync(filePath, content, "utf-8");
  return runZizmor(filePath);
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

describe.skipIf(!zizmorAvailable)("zizmor audit of renderBranchWorkflow", () => {
  const cases = [
    ...ALL_PM.map((pm) => ({
      name: `branch / ${pm} / minimal`,
      fileName: `branch-${pm}`,
      params: { packageManager: pm },
    })),
    {
      name: "branch / pnpm / with workingDirectory",
      fileName: "branch-pnpm-dir",
      params: { packageManager: "pnpm" as const, workingDirectory: "apps/backend" },
    },
    {
      name: "branch / pnpm / with explicit environment",
      fileName: "branch-pnpm-env",
      params: { packageManager: "pnpm" as const, environment: "production" },
    },
    {
      name: "branch / pnpm / with ERD preview",
      fileName: "branch-pnpm-erd-preview",
      params: {
        packageManager: "pnpm" as const,
        erdPreview: { namespaces: ["tailordb", "analyticsdb"] },
      },
    },
    {
      name: "branch / npm / with seed validation + workingDirectory + environment",
      fileName: "branch-npm-dir-env",
      params: {
        branch: "develop",
        packageManager: "npm" as const,
        seedValidate: true,
        workingDirectory: "apps/api",
        environment: "staging",
      },
    },
    {
      name: "branch / pnpm / with restricted dispatch",
      fileName: "branch-pnpm-restrict",
      params: { packageManager: "pnpm" as const, restrictDispatch: true },
    },
  ];

  test.each(cases)("$name has no zizmor findings", ({ fileName, params }) => {
    const { content } = renderBranchWorkflow({
      ...COMMON,
      branch: "main",
      erdPreview: null,
      ...params,
    });
    const { ok, output } = writeAndAudit(fileName, content);
    expect(ok, `zizmor findings:\n${output}`).toBe(true);
  });
});

describe.skipIf(!zizmorAvailable)("zizmor audit of renderTagWorkflow", () => {
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
      name: "tag / pnpm / with branch guard / restricted dispatch",
      fileName: "tag-pnpm-guard-restrict",
      params: {
        tagPattern: "v*",
        packageManager: "pnpm" as const,
        branch: "main",
        restrictDispatch: true,
      },
    },
    {
      name: "tag / pnpm / no guard / restricted dispatch",
      fileName: "tag-pnpm-noguard-restrict",
      params: { tagPattern: "v*", packageManager: "pnpm" as const, restrictDispatch: true },
    },
    {
      name: "tag / bun / no guard / with explicit environment",
      fileName: "tag-bun-noguard-env",
      params: { tagPattern: "v*", packageManager: "bun" as const, environment: "production" },
    },
  ];

  test.each(cases)("$name has no zizmor findings", ({ fileName, params }) => {
    const { content } = renderTagWorkflow({ ...COMMON, ...params });
    const { ok, output } = writeAndAudit(fileName, content);
    expect(ok, `zizmor findings:\n${output}`).toBe(true);
  });
});

describe.skipIf(!zizmorAvailable)("zizmor audit of renderCoordinateWorkflow", () => {
  const COORD_COMMON = {
    coordinatorName: "main",
    actionGroups: [{ id: "api", apps: [{ name: "api", dir: "." }] }],
    environment: "production",
    packageManager: "pnpm" as PackageManager,
  };

  test("coordinate / branch has no zizmor findings", () => {
    const { content } = renderCoordinateWorkflow({
      ...COORD_COMMON,
      kind: "branch",
      branch: "main",
    });
    const { ok, output } = writeAndAudit("coord-branch", content);
    expect(ok, `zizmor findings:\n${output}`).toBe(true);
  });

  test("coordinate / tag has no zizmor findings", () => {
    const { content } = renderCoordinateWorkflow({
      ...COORD_COMMON,
      kind: "tag",
      branch: "main",
      tagPattern: "v*",
    });
    const { ok, output } = writeAndAudit("coord-tag", content);
    expect(ok, `zizmor findings:\n${output}`).toBe(true);
  });

  test.each(["branch", "tag"] as const)(
    "coordinate / %s / restricted dispatch has no zizmor findings",
    (kind) => {
      const { content } = renderCoordinateWorkflow({
        ...COORD_COMMON,
        kind,
        branch: "main",
        tagPattern: "v*",
        restrictDispatch: true,
      });
      const { ok, output } = writeAndAudit(`coord-${kind}-restrict`, content);
      expect(ok, `zizmor findings:\n${output}`).toBe(true);
    },
  );
});

describe.skipIf(!zizmorAvailable)("zizmor audit of the coordinate composite actions", () => {
  test.each([false, true])(
    "per-app action (static websites: %s) has no zizmor findings",
    (hasStaticWebsites) => {
      const { content } = renderActionWorkflow({ workspaceName: "my-app", hasStaticWebsites });
      const { ok, output } = writeAndAuditAction(`tailor-api-${hasStaticWebsites}`, content);
      expect(ok, `zizmor findings:\n${output}`).toBe(true);
    },
  );

  test.each(ALL_PM)("tailor-setup action / %s has no zizmor findings", (packageManager) => {
    const { ok, output } = writeAndAuditAction(
      `tailor-setup-${packageManager}`,
      renderTailorSetupAction({ packageManager }),
    );
    expect(ok, `zizmor findings:\n${output}`).toBe(true);
  });
});

describe.skipIf(!zizmorAvailable)("zizmor audit of renderPreviewWorkflow", () => {
  const PREVIEW_COMMON = {
    ...COMMON,
    branch: "main",
    region: "us-west",
    packageManager: "pnpm" as PackageManager,
  };

  test.each([
    { name: "preview / pnpm / all PRs", fileName: "preview-pnpm-all", params: {} },
    {
      name: "preview / pnpm / label-triggered",
      fileName: "preview-pnpm-label",
      params: { requirePreviewLabel: true },
    },
    {
      name: "preview / pnpm / with workingDirectory",
      fileName: "preview-pnpm-dir",
      params: { workingDirectory: "apps/backend" },
    },
  ])("$name has no zizmor findings", ({ fileName, params }) => {
    const { content } = renderPreviewWorkflow({
      ...PREVIEW_COMMON,
      requirePreviewLabel: false,
      ...params,
    });
    const { ok, output } = writeAndAudit(fileName, content);
    expect(ok, `zizmor findings:\n${output}`).toBe(true);
  });
});
