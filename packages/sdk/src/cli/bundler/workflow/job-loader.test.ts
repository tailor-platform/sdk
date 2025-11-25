import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkflowJobLoader } from "./job-loader";
import type { WorkflowServiceConfig } from "@/configure/services/workflow/types";

describe("WorkflowJobLoader", () => {
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

  describe("collectAllJobs", () => {
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

      await expect(WorkflowJobLoader.collectAllJobs(config)).rejects.toThrow(
        /Duplicate job name "duplicate-name"/,
      );
    });

    it("should return empty array when no files configured", async () => {
      const config: WorkflowServiceConfig = {
        files: [],
      };

      const result = await WorkflowJobLoader.collectAllJobs(config);
      expect(result).toEqual([]);
    });

    it("should return empty array when files is undefined", async () => {
      const config = {} as WorkflowServiceConfig;

      const result = await WorkflowJobLoader.collectAllJobs(config);
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
      const result = await WorkflowJobLoader.collectAllJobs(config);

      // process-data should be included as it's used by the workflow
      expect(result.find((j) => j.name === "process-data")).toBeDefined();
    });

    it("should handle internal jobs (not exported but used via deps)", async () => {
      const workflowFile = path.join(tempDir, "workflow-with-internal.ts");
      fs.writeFileSync(
        workflowFile,
        `
        import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

        // Internal job - not exported
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

      // Should not throw error - internal jobs are valid
      const result = await WorkflowJobLoader.collectAllJobs(config);

      // main-job should be returned (it's exported and used)
      expect(result.find((j) => j.name === "main-job")).toBeDefined();

      // internal-job should NOT be in result (not exported, so can't be bundled as entry point)
      // but it should not cause an error either
      expect(result.find((j) => j.name === "internal-job")).toBeUndefined();
    });
  });
});
