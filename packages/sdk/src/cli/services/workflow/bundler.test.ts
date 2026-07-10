import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { buildTriggerContext, normalizeFilePath } from "#/cli/shared/trigger-context";
import { bundleWorkflowJobs } from "./bundler";

describe("bundleWorkflowJobs", () => {
  test("does not throw when no workflow jobs are provided", async () => {
    await expect(bundleWorkflowJobs([], [], {}, { modules: new Map() })).resolves.toEqual({
      mainJobDeps: {},
      usedJobNames: [],
      bundledCode: new Map(),
    });
  });

  describe("job trigger binding resolution", () => {
    let tmpDir: string | undefined;

    afterEach(() => {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
      }
    });

    function createTempDir() {
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "job-binding-test-")));
      return tmpDir;
    }

    test("resolves duplicate local export names from the job's module", async () => {
      const dir = createTempDir();
      const firstFile = path.join(dir, "first.ts");
      const secondFile = path.join(dir, "second.ts");
      fs.writeFileSync(
        firstFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const step = createWorkflowJob({ name: "step-a", body: async () => "a" });
export const mainA = createWorkflowJob({
  name: "main-a",
  body: async () => await step.trigger(),
});
export default createWorkflow({ name: "workflow-a", mainJob: mainA });
`,
      );
      fs.writeFileSync(
        secondFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const step = createWorkflowJob({ name: "step-b", body: async () => "b" });
export const mainB = createWorkflowJob({
  name: "main-b",
  body: async () => await step.trigger(),
});
export default createWorkflow({ name: "workflow-b", mainJob: mainB });
`,
      );
      const context = await buildTriggerContext({ files: [firstFile, secondFile] });

      const result = await bundleWorkflowJobs(
        [
          { name: "step-a", exportName: "step", sourceFile: firstFile },
          { name: "main-a", exportName: "mainA", sourceFile: firstFile },
          { name: "step-b", exportName: "step", sourceFile: secondFile },
          { name: "main-b", exportName: "mainB", sourceFile: secondFile },
        ],
        ["main-a"],
        {},
        context,
      );

      expect(result.mainJobDeps["main-a"]).toEqual(["main-a", "step-a"]);
      expect(result.usedJobNames).toEqual(["step-a", "main-a"]);
      expect(result.bundledCode.get("main-a")).toMatch(/triggerJobFunction\([`'"]step-a/);
      expect(result.bundledCode.get("main-a")).not.toMatch(/triggerJobFunction\([`'"]step-b/);
    });

    test("includes jobs referenced through aliased named imports", async () => {
      const dir = createTempDir();
      const jobsFile = path.join(dir, "jobs.ts");
      const callerFile = path.join(dir, "caller.ts");
      fs.writeFileSync(
        jobsFile,
        `
import { createWorkflowJob } from "@tailor-platform/sdk";
export const step = createWorkflowJob({ name: "step-a", body: async () => "a" });
`,
      );
      fs.writeFileSync(
        callerFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { step as importedStep } from "./jobs";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: async () => await importedStep.trigger(),
});
export default createWorkflow({ name: "workflow", mainJob });
`,
      );
      const context = await buildTriggerContext({ files: [jobsFile, callerFile] });

      const result = await bundleWorkflowJobs(
        [
          { name: "step-a", exportName: "step", sourceFile: jobsFile },
          { name: "main-job", exportName: "mainJob", sourceFile: callerFile },
        ],
        ["main-job"],
        {},
        context,
      );

      expect(result.mainJobDeps["main-job"]).toEqual(["main-job", "step-a"]);
      expect(result.usedJobNames).toEqual(["step-a", "main-job"]);
      expect(result.bundledCode.get("main-job")).toMatch(/triggerJobFunction\([`'"]step-a/);
    });

    test("does not include a job whose binding is shadowed by a parameter", async () => {
      const dir = createTempDir();
      const workflowFile = path.join(dir, "workflow.ts");
      fs.writeFileSync(
        workflowFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const step = createWorkflowJob({ name: "step-a", body: async () => "a" });
export const mainJob = createWorkflowJob({
  name: "main-job",
  body: async (step: { trigger(): Promise<string> }) => await step.trigger(),
});
export default createWorkflow({ name: "workflow", mainJob });
`,
      );
      const context = await buildTriggerContext({ files: [workflowFile] });

      const result = await bundleWorkflowJobs(
        [
          { name: "step-a", exportName: "step", sourceFile: workflowFile },
          { name: "main-job", exportName: "mainJob", sourceFile: workflowFile },
        ],
        ["main-job"],
        {},
        context,
      );

      expect(result.mainJobDeps["main-job"]).toEqual(["main-job"]);
      expect(result.usedJobNames).toEqual(["main-job"]);
      expect(result.bundledCode.get("main-job")).not.toContain("triggerJobFunction");
    });
  });

  describe("cross-file workflow default import", () => {
    let tmpDir: string | undefined;

    type BuildBundleFixtureOptions = {
      ext: string;
      importPath: string;
      triggerArgs?: string;
    };

    afterEach(() => {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
      }
    });

    const buildBundleFixture = (options: BuildBundleFixtureOptions) => {
      const { ext, importPath, triggerArgs = `{ input: 0 }, { authInvoker: "admin" }` } = options;

      // Use realpathSync to avoid macOS symlink mismatch (/var -> /private/var)
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundler-test-")));

      const simpleFile = path.join(tmpDir, `simple.${ext}`);
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

      const callerFile = path.join(tmpDir, `caller.${ext}`);
      fs.writeFileSync(
        callerFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import simpleWorkflow from "${importPath}";

export const callerJob = createWorkflowJob({
  name: "caller-job",
  body: async () => {
    const executionId = await simpleWorkflow.trigger(${triggerArgs});
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

      const triggerContext = {
        modules: new Map([
          [
            normalizeFilePath(simpleFile),
            {
              localBindings: new Map([["step1", { kind: "job" as const, name: "step1" }]]),
              exports: new Map([
                ["step1", { kind: "job" as const, name: "step1" }],
                ["default", { kind: "workflow" as const, name: "simple-workflow" }],
              ]),
            },
          ],
          [
            normalizeFilePath(callerFile),
            {
              localBindings: new Map([["callerJob", { kind: "job" as const, name: "caller-job" }]]),
              exports: new Map([
                ["callerJob", { kind: "job" as const, name: "caller-job" }],
                ["default", { kind: "workflow" as const, name: "caller-workflow" }],
              ]),
            },
          ],
        ]),
        authNamespace: "default",
      };

      return bundleWorkflowJobs(allJobs, mainJobNames, {}, triggerContext);
    };

    test.each([
      { label: "cross-file default import", ext: "ts", importPath: "./simple" },
      { label: ".mts dependency files", ext: "mts", importPath: "./simple.mjs" },
    ])("transforms workflow.trigger() from $label", async (options) => {
      const { ext, importPath } = options;
      const result = await buildBundleFixture({ ext, importPath });

      expect(result.bundledCode.has("caller-job")).toBe(true);
      const callerCode = result.bundledCode.get("caller-job")!;

      // The trigger call should be transformed to triggerWorkflow
      expect(callerCode).toContain("triggerWorkflow");
      // The raw simpleWorkflow.trigger() should NOT remain in the bundle
      expect(callerCode).not.toContain("simpleWorkflow.trigger");
    });

    test("strips platform-bundle-only symbols from cross-file default import", async () => {
      const result = await buildBundleFixture({ ext: "ts", importPath: "./simple" });

      // The platform bundle must fold away the TAILOR_PLATFORM_BUNDLE gate and
      // tree-shake every test-only symbol; otherwise an unsubstituted process.env.*
      // reaches the Platform Web runtime (no `process`) and crashes.
      for (const code of result.bundledCode.values()) {
        expect(code).not.toContain("process.env.TAILOR_PLATFORM_BUNDLE");
        expect(code).not.toContain("job-registry");
        expect(code).not.toContain("registerJob");
        expect(code).not.toContain("platformSerialize");
      }
    });

    test("transforms workflow.trigger() without an options argument", async () => {
      const result = await buildBundleFixture({
        ext: "ts",
        importPath: "./simple",
        triggerArgs: "{ input: 0 }",
      });

      expect(result.bundledCode.has("caller-job")).toBe(true);
      const callerCode = result.bundledCode.get("caller-job")!;

      expect(callerCode).toContain("triggerWorkflow");
      expect(callerCode).not.toContain("simpleWorkflow.trigger");
    });
  });
});
