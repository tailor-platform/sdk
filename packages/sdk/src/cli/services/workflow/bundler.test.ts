import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { normalizeFilePath } from "#/cli/shared/trigger-context";
import { bundleWorkflowJobs } from "./bundler";

describe("bundleWorkflowJobs", () => {
  test("does not throw when no workflow jobs are provided", async () => {
    await expect(bundleWorkflowJobs([], [], {})).resolves.toEqual({
      mainJobDeps: {},
      usedJobNames: [],
      bundledCode: new Map(),
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
      const { ext, importPath, triggerArgs = `{ input: 0 }, { invoker: "admin" }` } = options;

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

      const workflowFileMap = new Map<string, string>([
        [normalizeFilePath(simpleFile), "simple-workflow"],
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
        expect(code).not.toContain("process.env.__TAILOR_PLATFORM_BUNDLE");
        expect(code).not.toContain("async_hooks");
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
