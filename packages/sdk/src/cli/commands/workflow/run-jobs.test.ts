import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempDir } from "#/cli/shared/test-helpers/temp-dir";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import { bundleWorkflowRunJobs } from "./run-jobs";
import type { FunctionRunTarget } from "../function/run-function";

const WORKFLOW = `import { createWorkflowJob } from "@tailor-platform/sdk";

export const validateOrder = createWorkflowJob({
  name: "validate-order",
  body: (input: { id: string }) => ({ id: input.id, valid: true }),
});

export const processOrder = createWorkflowJob({
  name: "process-order",
  body: async (input: { id: string }) => {
    const checked = await validateOrder.start({ id: input.id });
    return { processed: input.id, checked };
  },
});

export const lonely = createWorkflowJob({
  name: "lonely",
  body: () => "alone",
});
`;

function setup(dir: string, files: Record<string, string> = {}) {
  const filePath = path.join(dir, "orders.ts");
  fs.writeFileSync(filePath, WORKFLOW);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  const target = {
    filePath,
    jobName: undefined,
    jobFlag: "--job",
    config: { path: path.join(dir, "tailor.config.ts"), env: { region: "x" } },
    kyselyTemporal: false,
    authNamespace: "auth",
  } as unknown as FunctionRunTarget;
  return { target, filePath };
}

describe("bundleWorkflowRunJobs", () => {
  test("bundles the selected job and the jobs it starts, and no others", async () => {
    using tmp = tempDir("workflow-run-jobs-");
    const { target } = setup(tmp.dir);

    const bundled = await bundleWorkflowRunJobs({ target, runId: "r1", jobName: "process-order" });

    expect(bundled.jobs.map((job) => job.jobName).toSorted()).toEqual([
      "process-order",
      "validate-order",
    ]);
    expect(bundled.mainJobName).toBe("process-order");
  });

  test("makes the parent start the child under the name this run registers it by", async () => {
    using tmp = tempDir("workflow-run-jobs-");
    const { target } = setup(tmp.dir);

    const bundled = await bundleWorkflowRunJobs({ target, runId: "r1", jobName: "process-order" });

    const parent = bundled.jobs.find((job) => job.jobName === "process-order");
    expect(parent?.code).toMatch(/execJobFunction\(["`]tmp-run-r1-validate-order["`]/);
    expect(parent?.code).not.toMatch(/execJobFunction\(["`]validate-order["`]/);
  });

  test("bundles only the selected job when it starts no other job", async () => {
    using tmp = tempDir("workflow-run-jobs-");
    const { target } = setup(tmp.dir);

    const bundled = await bundleWorkflowRunJobs({ target, runId: "r1", jobName: "lonely" });

    expect(bundled.jobs.map((job) => job.jobName)).toEqual(["lonely"]);
  });

  test("refuses a job the file does not define, listing the jobs it does", async () => {
    using tmp = tempDir("workflow-run-jobs-");
    const { target } = setup(tmp.dir);

    await expect(
      bundleWorkflowRunJobs({ target, runId: "r1", jobName: "missing" }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_JOB_NOT_FOUND",
      details: expect.stringContaining("validate-order"),
    });
  });

  test("refuses a job name that a configured workflow file defines too, rather than running the other file's body", async () => {
    using tmp = tempDir("workflow-run-jobs-");
    const { target } = setup(tmp.dir, {
      "other.ts": `import { createWorkflowJob } from "@tailor-platform/sdk";

export const lonelyElsewhere = createWorkflowJob({
  name: "lonely",
  body: () => "from another file",
});
`,
    });
    (target.config as { workflow?: unknown }).workflow = { files: ["other.ts"] };

    await expect(
      bundleWorkflowRunJobs({ target, runId: "r1", jobName: "lonely" }),
    ).rejects.toMatchObject({
      code: "DEFINITION_NAME_DUPLICATE",
      message: expect.stringContaining("other.ts"),
    });
  });

  test("accepts the re-exported job also when user modules are imported afresh for each run", async () => {
    beginUserModuleRun();
    using tmp = tempDir("workflow-run-jobs-");
    const { target } = setup(tmp.dir, {
      "b.ts": `import { createWorkflowJob } from "@tailor-platform/sdk";
export const bJob = createWorkflowJob({ name: "b-job", body: () => "b" });
`,
      "x.ts": `import { createWorkflowJob } from "@tailor-platform/sdk";
import { bJob } from "./b";
export { bJob };
export const aJob = createWorkflowJob({
  name: "a-job",
  body: async () => ({ saw: await bJob.start() }),
});
`,
    });
    (target as { filePath: string }).filePath = path.join(tmp.dir, "x.ts");
    (target.config as { workflow?: unknown }).workflow = { files: ["b.ts"] };

    const bundled = await bundleWorkflowRunJobs({ target, runId: "r1", jobName: "a-job" });
    expect(bundled.jobs.map((j) => j.jobName).toSorted()).toEqual(["a-job", "b-job"]);
  });

  test("accepts a job the selected file re-exports from a configured workflow file", async () => {
    using tmp = tempDir("workflow-run-jobs-");
    const { target } = setup(tmp.dir, {
      "b.ts": `import { createWorkflowJob } from "@tailor-platform/sdk";
export const bJob = createWorkflowJob({ name: "b-job", body: () => "b" });
`,
      "x.ts": `import { createWorkflowJob } from "@tailor-platform/sdk";
import { bJob } from "./b";
export { bJob };
export const aJob = createWorkflowJob({
  name: "a-job",
  body: async () => ({ saw: await bJob.start() }),
});
`,
    });
    (target as { filePath: string }).filePath = path.join(tmp.dir, "x.ts");
    (target.config as { workflow?: unknown }).workflow = { files: ["b.ts"] };

    const bundled = await bundleWorkflowRunJobs({ target, runId: "r1", jobName: "a-job" });
    expect(bundled.jobs.map((j) => j.jobName).toSorted()).toEqual(["a-job", "b-job"]);
  });

  test("reads the file it was given, not another one its name matches as a pattern", async () => {
    using tmp = tempDir("workflow-run-jobs-");
    const { target } = setup(tmp.dir, {
      "jobs[1].ts": `import { createWorkflowJob } from "@tailor-platform/sdk";
export const bracket = createWorkflowJob({ name: "bracket-job", body: () => "from jobs[1]" });
`,
      "jobs1.ts": `import { createWorkflowJob } from "@tailor-platform/sdk";
export const one = createWorkflowJob({ name: "one-job", body: () => "from jobs1" });
`,
    });
    (target as { filePath: string }).filePath = path.join(tmp.dir, "jobs[1].ts");

    const bundled = await bundleWorkflowRunJobs({ target, runId: "r1", jobName: "bracket-job" });

    expect(bundled.jobs.map((job) => job.jobName)).toEqual(["bracket-job"]);
    expect(bundled.jobs[0]?.code).toContain("from jobs[1]");
  });
});
