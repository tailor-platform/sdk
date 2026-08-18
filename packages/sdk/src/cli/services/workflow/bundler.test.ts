import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { buildStartContext, normalizeFilePath } from "#/cli/shared/start-context";
import {
  bundleWorkflowJobs,
  collectExecJobFunctionTargets,
  validateBundledDependencies,
} from "./bundler";

describe("bundleWorkflowJobs", () => {
  test("does not throw when no workflow jobs are provided", async () => {
    await expect(
      bundleWorkflowJobs([], [], {}, { modules: new Map() }, process.cwd()),
    ).resolves.toEqual({
      mainJobDeps: {},
      usedJobNames: [],
      bundledCode: new Map(),
    });
  });

  test("passes the mapped invoker to the job body", async () => {
    const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "job-invoker-test-")));
    const sourceFile = path.join(tmpDir, "workflow.ts");
    fs.writeFileSync(
      sourceFile,
      `
import { createWorkflowJob } from "@tailor-platform/sdk";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: async (_input, { invoker }) => invoker,
});
`,
    );
    vi.stubGlobal("tailor", {
      context: {
        getInvoker: () => ({
          id: "invoker-id",
          type: "machine_user",
          workspaceId: "workspace-id",
          attributeMap: { role: "ADMIN" },
          attributes: [{ name: "role", value: "ADMIN" }],
        }),
      },
    });

    try {
      const result = await bundleWorkflowJobs(
        [{ name: "main-job", exportName: "mainJob", sourceFile }],
        ["main-job"],
        {},
        { modules: new Map() },
        tmpDir,
        undefined,
        true,
      );
      const code = result.bundledCode.get("main-job");
      expect(code).toBeDefined();
      const moduleUrl = `data:text/javascript;base64,${Buffer.from(code!).toString("base64")}`;
      const module = (await import(moduleUrl)) as { main: (input: unknown) => Promise<unknown> };

      await expect(module.main({})).resolves.toEqual({
        id: "invoker-id",
        type: "machine_user",
        workspaceId: "workspace-id",
        attributes: { role: "ADMIN" },
        attributeList: [{ name: "role", value: "ADMIN" }],
      });
    } finally {
      vi.unstubAllGlobals();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("job start binding resolution", () => {
    let tmpDir: string | undefined;

    aroundEach(async (runTest) => {
      await runTest();
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
  body: async () => await step.start(),
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
  body: async () => await step.start(),
});
export default createWorkflow({ name: "workflow-b", mainJob: mainB });
`,
      );
      const context = await buildStartContext({ files: [firstFile, secondFile] });

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
        dir,
      );

      expect(result.mainJobDeps["main-a"]).toEqual(["main-a", "step-a"]);
      expect(result.usedJobNames).toEqual(["step-a", "main-a"]);
      expect(result.bundledCode.get("main-a")).toMatch(/execJobFunction\([`'"]step-a/);
      expect(result.bundledCode.get("main-a")).not.toMatch(/execJobFunction\([`'"]step-b/);
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
  body: async () => await importedStep.start(),
});
export default createWorkflow({ name: "workflow", mainJob });
`,
      );
      const context = await buildStartContext({ files: [jobsFile, callerFile] });

      const result = await bundleWorkflowJobs(
        [
          { name: "step-a", exportName: "step", sourceFile: jobsFile },
          { name: "main-job", exportName: "mainJob", sourceFile: callerFile },
        ],
        ["main-job"],
        {},
        context,
        dir,
      );

      expect(result.mainJobDeps["main-job"]).toEqual(["main-job", "step-a"]);
      expect(result.usedJobNames).toEqual(["step-a", "main-job"]);
      expect(result.bundledCode.get("main-job")).toMatch(/execJobFunction\([`'"]step-a/);
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
  body: async (step: { start(): Promise<string> }) => await step.start(),
});
export default createWorkflow({ name: "workflow", mainJob });
`,
      );
      const context = await buildStartContext({ files: [workflowFile] });

      const result = await bundleWorkflowJobs(
        [
          { name: "step-a", exportName: "step", sourceFile: workflowFile },
          { name: "main-job", exportName: "mainJob", sourceFile: workflowFile },
        ],
        ["main-job"],
        {},
        context,
        dir,
      );

      expect(result.mainJobDeps["main-job"]).toEqual(["main-job"]);
      expect(result.usedJobNames).toEqual(["main-job"]);
      expect(result.bundledCode.get("main-job")).not.toContain("execJobFunction");
    });

    test("throws when a job's name/body is not statically literal", async () => {
      const dir = createTempDir();
      const workflowFile = path.join(dir, "workflow.ts");
      fs.writeFileSync(
        workflowFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const nonLiteralBody = async () => "value";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: nonLiteralBody,
});
export default createWorkflow({ name: "workflow", mainJob });
`,
      );
      const context = await buildStartContext({ files: [workflowFile] });

      await expect(
        bundleWorkflowJobs(
          [{ name: "main-job", exportName: "mainJob", sourceFile: workflowFile }],
          ["main-job"],
          {},
          context,
          dir,
        ),
      ).rejects.toThrow(/main-job/);
    });

    test("throws a parse error (not a misleading literal-config error) for a syntax error", async () => {
      const dir = createTempDir();
      const workflowFile = path.join(dir, "workflow.ts");
      fs.writeFileSync(
        workflowFile,
        `
import { createWorkflowJob } from "@tailor-platform/sdk";

export const step = createWorkflowJob({ name: "step-a", body: async () => "a" });

this is not valid syntax &&&
`,
      );
      const context = await buildStartContext({ files: [workflowFile] });

      await expect(
        bundleWorkflowJobs(
          [{ name: "step-a", exportName: "step", sourceFile: workflowFile }],
          ["step-a"],
          {},
          context,
          dir,
        ),
      ).rejects.toThrow(/parse/i);
    });

    test("throws when a start() call is factored outside any job body", async () => {
      const dir = createTempDir();
      const workflowFile = path.join(dir, "workflow.ts");
      fs.writeFileSync(
        workflowFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const step = createWorkflowJob({ name: "step-a", body: async () => "a" });

async function runStep() {
  return await step.start();
}

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: async () => await runStep(),
});
export default createWorkflow({ name: "workflow", mainJob });
`,
      );
      const context = await buildStartContext({ files: [workflowFile] });

      await expect(
        bundleWorkflowJobs(
          [
            { name: "step-a", exportName: "step", sourceFile: workflowFile },
            { name: "main-job", exportName: "mainJob", sourceFile: workflowFile },
          ],
          ["main-job"],
          {},
          context,
          dir,
        ),
      ).rejects.toThrow(/step-a/);
    });

    test("throws when a start() call is factored into a helper in another file", async () => {
      const dir = createTempDir();
      const jobsFile = path.join(dir, "jobs.ts");
      const helpersFile = path.join(dir, "helpers.ts");
      const workflowFile = path.join(dir, "workflow.ts");
      fs.writeFileSync(
        jobsFile,
        `
import { createWorkflowJob } from "@tailor-platform/sdk";
export const step = createWorkflowJob({ name: "step-a", body: async () => "a" });
`,
      );
      fs.writeFileSync(
        helpersFile,
        `
import { step } from "./jobs";
export async function runStep() {
  return await step.start();
}
`,
      );
      fs.writeFileSync(
        workflowFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { runStep } from "./helpers";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: async () => await runStep(),
});
export default createWorkflow({ name: "workflow", mainJob });
`,
      );
      const context = await buildStartContext({ files: [jobsFile, helpersFile, workflowFile] });

      await expect(
        bundleWorkflowJobs(
          [
            { name: "step-a", exportName: "step", sourceFile: jobsFile },
            { name: "main-job", exportName: "mainJob", sourceFile: workflowFile },
          ],
          ["main-job"],
          {},
          context,
          dir,
        ),
      ).rejects.toThrow(/step-a/);
    });

    test("throws when a factored-out start() call lives in a file outside workflow.files", async () => {
      const dir = createTempDir();
      const workflowsDir = path.join(dir, "workflows");
      const sharedDir = path.join(dir, "shared");
      fs.mkdirSync(workflowsDir);
      fs.mkdirSync(sharedDir);

      const jobsFile = path.join(workflowsDir, "jobs.ts");
      const helpersFile = path.join(sharedDir, "helpers.ts");
      const workflowFile = path.join(workflowsDir, "workflow.ts");
      fs.writeFileSync(
        jobsFile,
        `
import { createWorkflowJob } from "@tailor-platform/sdk";
export const step = createWorkflowJob({ name: "step-a", body: async () => "a" });
`,
      );
      fs.writeFileSync(
        helpersFile,
        `
import { step } from "../workflows/jobs";
export async function runStep() {
  return await step.start();
}
`,
      );
      fs.writeFileSync(
        workflowFile,
        `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { runStep } from "../shared/helpers";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: async () => await runStep(),
});
export default createWorkflow({ name: "workflow", mainJob });
`,
      );
      // workflow.files only covers workflows/**, not shared/** — the start-call
      // rewrite still resolves helpersFile's import, but StartContext.modules
      // never scans it, so this case can only be caught at the bundle output.
      const context = await buildStartContext({ files: [jobsFile, workflowFile] });

      await expect(
        bundleWorkflowJobs(
          [
            { name: "step-a", exportName: "step", sourceFile: jobsFile },
            { name: "main-job", exportName: "mainJob", sourceFile: workflowFile },
          ],
          ["main-job"],
          {},
          context,
          dir,
        ),
      ).rejects.toThrow(/step-a/);
    });
  });

  describe("cross-file workflow default import", () => {
    let tmpDir: string | undefined;

    type BuildBundleFixtureOptions = {
      ext: string;
      importPath: string;
      startArgs?: string;
    };

    aroundEach(async (runTest) => {
      await runTest();
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
      }
    });

    const buildBundleFixture = (options: BuildBundleFixtureOptions) => {
      const { ext, importPath, startArgs = `{ input: 0 }, { invoker: "admin" }` } = options;

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
    const executionId = await simpleWorkflow.start(${startArgs});
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

      const startContext = {
        modules: new Map([
          [
            normalizeFilePath(simpleFile),
            {
              sourceFile: simpleFile,
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
              sourceFile: callerFile,
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

      return bundleWorkflowJobs(allJobs, mainJobNames, {}, startContext, tmpDir);
    };

    test.each([
      { label: "cross-file default import", ext: "ts", importPath: "./simple" },
      { label: ".mts dependency files", ext: "mts", importPath: "./simple.mjs" },
    ])("transforms workflow.start() from $label", async (options) => {
      const { ext, importPath } = options;
      const result = await buildBundleFixture({ ext, importPath });

      expect(result.bundledCode.has("caller-job")).toBe(true);
      const callerCode = result.bundledCode.get("caller-job")!;

      // The start call should be transformed to startWorkflow
      expect(callerCode).toContain("startWorkflow");
      // The raw simpleWorkflow.start() should NOT remain in the bundle
      expect(callerCode).not.toContain("simpleWorkflow.start");
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

    test("transforms workflow.start() without an options argument", async () => {
      const result = await buildBundleFixture({
        ext: "ts",
        importPath: "./simple",
        startArgs: "{ input: 0 }",
      });

      expect(result.bundledCode.has("caller-job")).toBe(true);
      const callerCode = result.bundledCode.get("caller-job")!;

      expect(callerCode).toContain("startWorkflow");
      expect(callerCode).not.toContain("simpleWorkflow.start");
    });
  });

  describe("collectExecJobFunctionTargets", () => {
    test("throws instead of silently returning no targets for unparseable code", () => {
      expect(() => collectExecJobFunctionTargets("this is not valid js &&&")).toThrow(/parse/i);
    });

    test("finds a statically-named execJobFunction target", () => {
      expect(
        collectExecJobFunctionTargets("tailor.workflow.execJobFunction(`step-a`, void 0)"),
      ).toEqual(["step-a"]);
    });
  });

  describe("validateBundledDependencies", () => {
    test("names the caller job when its bundled code fails to parse", () => {
      const bundledCode = new Map([["main-job", "this is not valid js &&&"]]);
      expect(() => validateBundledDependencies(bundledCode, ["main-job"])).toThrow(/main-job/);
    });

    test("does not throw when every target is bundled", () => {
      const bundledCode = new Map([
        ["main-job", "tailor.workflow.execJobFunction(`step-a`, void 0)"],
      ]);
      expect(() => validateBundledDependencies(bundledCode, ["main-job", "step-a"])).not.toThrow();
    });
  });
});
