import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { collectAllJobs } from "./job-loader";
import type { WorkflowServiceConfig } from "@/configure/services/workflow/types";

describe("collectAllJobs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), "test-temp-workflow");
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    vi.restoreAllMocks();
  });

  it("should detect duplicate job names and throw error", async () => {
    // Create two files with the same job name
    const file1 = path.join(tempDir, "job1.ts");
    const file2 = path.join(tempDir, "job2.ts");

    fs.writeFileSync(
      file1,
      `
        import { createWorkflowJob } from "@tailor-platform/sdk";

        export const myJob = createWorkflowJob({
          name: "duplicate-name",
          body: () => "first",
        });
      `,
    );

    fs.writeFileSync(
      file2,
      `
        import { createWorkflowJob } from "@tailor-platform/sdk";

        export const anotherJob = createWorkflowJob({
          name: "duplicate-name",
          body: () => "second",
        });
      `,
    );

    const config: WorkflowServiceConfig = {
      files: [path.join(tempDir, "*.ts")],
    };

    await expect(collectAllJobs(config)).rejects.toThrow(
      /Duplicate job name "duplicate-name"/,
    );
  });

  it("should return empty array when no files configured", async () => {
    const config: WorkflowServiceConfig = {
      files: [],
    };

    const result = await collectAllJobs(config);
    expect(result).toEqual([]);
  });

  it("should return empty array when files is undefined", async () => {
    const config = {} as WorkflowServiceConfig;

    const result = await collectAllJobs(config);
    expect(result).toEqual([]);
  });

  it("should extract jobs from workflow files using AST detection", async () => {
    // Create a workflow file (contains createWorkflow)
    const workflowFile = path.join(tempDir, "my-workflow.ts");
    fs.writeFileSync(
      workflowFile,
      `
        import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

        export const processData = createWorkflowJob({
          name: "process-data",
          body: () => "processed",
        });

        export default createWorkflow({
          name: "data-workflow",
          mainJob: processData,
        });
      `,
    );

    // Create a standalone job file (no createWorkflow)
    const jobFile = path.join(tempDir, "standalone-job.ts");
    fs.writeFileSync(
      jobFile,
      `
        import { createWorkflowJob } from "@tailor-platform/sdk";

        export const unusedJob = createWorkflowJob({
          name: "unused-job",
          body: () => "unused",
        });
      `,
    );

    const config: WorkflowServiceConfig = {
      files: [path.join(tempDir, "*.ts")],
    };

    // Note: This test verifies the AST detection is used.
    // The workflow file should be detected by createWorkflow call, not filename.
    const result = await collectAllJobs(config);

    // process-data should be included as it's used by the workflow
    expect(result.find((j) => j.name === "process-data")).toBeDefined();
  });

  it("should throw error when job is used via deps but not exported", async () => {
    const workflowFile = path.join(tempDir, "workflow-with-internal.ts");
    fs.writeFileSync(
      workflowFile,
      `
        import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

        // Internal job - not exported (this should cause an error)
        const internalJob = createWorkflowJob({
          name: "internal-job",
          body: () => "internal",
        });

        // Main job - exported, depends on internal job
        export const mainJob = createWorkflowJob({
          name: "main-job",
          deps: [internalJob],
          body: (input, jobs) => jobs.internalJob(),
        });

        export default createWorkflow({
          name: "test-workflow",
          mainJob: mainJob,
        });
      `,
    );

    const config: WorkflowServiceConfig = {
      files: [path.join(tempDir, "*.ts")],
    };

    // Should throw error - all jobs must be named exports
    await expect(collectAllJobs(config)).rejects.toThrow(
      /The following workflow jobs are used but not exported/,
    );
    await expect(collectAllJobs(config)).rejects.toThrow(/"internal-job"/);
  });

  it("should handle shared job referenced by multiple workflows", async () => {
    // Create a shared job file
    const sharedJobFile = path.join(tempDir, "shared-job.ts");
    fs.writeFileSync(
      sharedJobFile,
      `
        import { createWorkflowJob } from "@tailor-platform/sdk";

        export const sharedJob = createWorkflowJob({
          name: "shared-job",
          body: () => "shared result",
        });
      `,
    );

    // Create first workflow that uses the shared job
    const workflow1File = path.join(tempDir, "workflow1.ts");
    fs.writeFileSync(
      workflow1File,
      `
        import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
        import { sharedJob } from "./shared-job";

        export const workflow1Main = createWorkflowJob({
          name: "workflow1-main",
          deps: [sharedJob],
          body: async (input, jobs) => {
            const result = await jobs.sharedJob();
            return { workflow: 1, result };
          },
        });

        export default createWorkflow({
          name: "workflow-1",
          mainJob: workflow1Main,
        });
      `,
    );

    // Create second workflow that also uses the shared job
    const workflow2File = path.join(tempDir, "workflow2.ts");
    fs.writeFileSync(
      workflow2File,
      `
        import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
        import { sharedJob } from "./shared-job";

        export const workflow2Main = createWorkflowJob({
          name: "workflow2-main",
          deps: [sharedJob],
          body: async (input, jobs) => {
            const result = await jobs.sharedJob();
            return { workflow: 2, result };
          },
        });

        export default createWorkflow({
          name: "workflow-2",
          mainJob: workflow2Main,
        });
      `,
    );

    const config: WorkflowServiceConfig = {
      files: [path.join(tempDir, "*.ts")],
    };

    // Should not throw error - shared jobs are valid
    const result = await collectAllJobs(config);

    // All three jobs should be included
    expect(result.find((j) => j.name === "shared-job")).toBeDefined();
    expect(result.find((j) => j.name === "workflow1-main")).toBeDefined();
    expect(result.find((j) => j.name === "workflow2-main")).toBeDefined();

    // shared-job should appear only once (no duplicates)
    const sharedJobCount = result.filter((j) => j.name === "shared-job").length;
    expect(sharedJobCount).toBe(1);
  });
});
