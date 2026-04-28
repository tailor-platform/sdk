import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { bundleWorkflowJobs } from "./bundler";

describe("bundleWorkflowJobs", () => {
  it("does not throw when no workflow jobs are provided", async () => {
    await expect(bundleWorkflowJobs([], [], {})).resolves.toEqual({
      mainJobDeps: {},
      usedJobNames: [],
      bundledCode: new Map(),
    });
  });

  describe("cross-file workflow default import", () => {
    let tmpDir: string | undefined;

    afterEach(() => {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
      }
    });

    it("transforms workflow.trigger() from cross-file default import", async () => {
      // Use realpathSync to avoid macOS symlink mismatch (/var -> /private/var)
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundler-test-")));

      // simple.ts: exports a workflow as default export
      const simpleFile = path.join(tmpDir, "simple.ts");
      fs.writeFileSync(
        simpleFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const step1 = createWorkflowJob({
  name: "step1",
  body: (args: { input: number }) => {
    return { result: args.input + 1 };
  },
});

export default createWorkflow({
  name: "simple-workflow",
  mainJob: step1,
});
`,
      );

      // caller.ts: imports the workflow via default export and calls .trigger()
      const callerFile = path.join(tmpDir, "caller.ts");
      fs.writeFileSync(
        callerFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import simpleWorkflow from "./simple";

export const callerJob = createWorkflowJob({
  name: "caller-job",
  body: async () => {
    const executionId = await simpleWorkflow.trigger({ input: 0 }, { authInvoker: "admin" });
    return { executionId };
  },
});

export default createWorkflow({
  name: "caller-workflow",
  mainJob: callerJob,
});
`,
      );

      const allJobs = [
        { name: "step1", exportName: "step1", sourceFile: simpleFile },
        { name: "caller-job", exportName: "callerJob", sourceFile: callerFile },
      ];
      const mainJobNames = ["caller-job"];

      // Build trigger context to enable trigger transformation
      // Normalize the same way production's normalizeFilePath does
      const workflowFileMap = new Map<string, string>([
        [path.resolve(simpleFile).replace(/\.ts$/, ""), "simple-workflow"],
      ]);
      const triggerContext = {
        workflowNameMap: new Map<string, string>(),
        jobNameMap: new Map<string, string>([
          ["step1", "step1"],
          ["callerJob", "caller-job"],
        ]),
        workflowFileMap,
        authNamespace: "default",
      };

      const result = await bundleWorkflowJobs(allJobs, mainJobNames, {}, triggerContext);

      expect(result.bundledCode.has("caller-job")).toBe(true);
      const callerCode = result.bundledCode.get("caller-job")!;

      // The trigger call should be transformed to triggerWorkflow
      expect(callerCode).toContain("triggerWorkflow");
      // The raw simpleWorkflow.trigger() should NOT remain in the bundle
      expect(callerCode).not.toContain("simpleWorkflow.trigger");
    });
  });
});
