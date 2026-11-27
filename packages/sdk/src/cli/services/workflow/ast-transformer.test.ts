import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { getErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { logger } from "#/cli/shared/logger";
import {
  buildStartContext,
  normalizeFilePath,
  type StartContext,
  type StartModuleBindings,
  type StartTarget,
} from "#/cli/shared/start-context";
import { makeTempDir, tempDir } from "#/cli/shared/test-helpers/temp-dir";
import { createHookFailures } from "../hook-failures";
import { findAllJobs } from "./job-detector";
import { transformWorkflowSource } from "./source-transformer";
import {
  createStartTransformPlugin,
  hasStartCall,
  transformStartCalls as transformStartCallsWithContext,
} from "./start-transformer";
import { findAllWorkflows } from "./workflow-detector";

function parseProgram(source: string) {
  return parseSync("test.ts", source).program;
}

function findJobs(source: string) {
  return findAllJobs(parseProgram(source), source);
}

function findWorkflows(source: string) {
  return findAllWorkflows(parseProgram(source), source);
}

function transformStartCalls(
  source: string,
  workflowNameMap: Map<string, string>,
  jobNameMap: Map<string, string>,
  workflowFileMap?: Map<string, string>,
  currentFilePath = path.resolve("test.ts"),
  authNamespace?: string,
  machineUserAuthNamespaces?: StartContext["machineUserAuthNamespaces"],
) {
  const localBindings = new Map<string, StartTarget>();
  for (const [name, jobName] of jobNameMap) {
    localBindings.set(name, { kind: "job", name: jobName });
  }
  for (const [name, workflowName] of workflowNameMap) {
    localBindings.set(name, { kind: "workflow", name: workflowName });
  }

  const modules = new Map<string, StartModuleBindings>([
    [
      normalizeFilePath(currentFilePath),
      { sourceFile: currentFilePath, localBindings, exports: new Map(localBindings) },
    ],
  ]);
  for (const [file, workflowName] of workflowFileMap ?? []) {
    modules.set(normalizeFilePath(file), {
      sourceFile: file,
      localBindings: new Map(),
      exports: new Map([["default", { kind: "workflow", name: workflowName }]]),
    });
  }

  const context: StartContext = { modules, authNamespace, machineUserAuthNamespaces };
  return transformStartCallsWithContext(source, context, currentFilePath).toString();
}

function transformWorkflowJobSource(
  source: string,
  targetJobName: string,
  targetJobExportName: string,
  otherJobExportNames: string[],
  jobNameMap: Map<string, string>,
) {
  const stripped = transformWorkflowSource(
    source,
    targetJobName,
    targetJobExportName,
    otherJobExportNames,
  ).toString();
  return transformStartCalls(stripped, new Map(), jobNameMap);
}

describe("AST Transformer - createWorkflowJob call detection", () => {
  describe("findAllJobs", () => {
    test("detects jobs whose bodies contain sparse arrays", () => {
      const source = `import { createWorkflowJob } from "@tailor-platform/sdk";
export const sparse = createWorkflowJob({ name: "sparse", body: () => [, "value"] });`;
      expect(findJobs(source)).toMatchObject([{ name: "sparse", exportName: "sparse" }]);
    });

    test("detects createWorkflowJob calls", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const job1 = createWorkflowJob({
  name: "job-one",
  body: async () => { return "one"; }
});

const job2 = createWorkflowJob({
  name: "job-two",
  body: async (input, { env }) => {
    return await job1.start();
  }
});
`;
      const jobs = findJobs(source);

      expect(jobs).toHaveLength(2);
      expect(jobs[0]!.name).toBe("job-one");
      expect(jobs[0]!.exportName).toBe("job1");
      expect(jobs[1]!.name).toBe("job-two");
      expect(jobs[1]!.exportName).toBe("job2");
    });

    test("does not detect objects where body is not a function", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const notAJob = createWorkflowJob({
  name: "not-a-job",
  body: "string value"
});

const realJob = createWorkflowJob({
  name: "real-job",
  body: async () => {}
});
`;
      const jobs = findJobs(source);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.name).toBe("real-job");
    });

    test("does not detect objects where name is not a string literal", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const notAJob = createWorkflowJob({
  name: someVariable,
  body: () => {}
});

const realJob = createWorkflowJob({
  name: "real-job",
  body: async () => {}
});
`;
      const jobs = findJobs(source);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.name).toBe("real-job");
    });

    test("bodyValueRange returns correct position", () => {
      const source = `import { createWorkflowJob } from "@tailor-platform/sdk";
const job = createWorkflowJob({ name: "test", body: () => { return 42; } });`;
      const jobs = findJobs(source);

      expect(jobs).toHaveLength(1);
      const bodyCode = source.slice(jobs[0]!.bodyValueRange.start, jobs[0]!.bodyValueRange.end);
      expect(bodyCode).toBe("() => { return 42; }");
    });

    test("exportName is extracted from variable declaration", () => {
      const source = `import { createWorkflowJob } from "@tailor-platform/sdk";
export const myJob = createWorkflowJob({ name: "my-job-name", body: () => {} });`;
      const jobs = findJobs(source);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.name).toBe("my-job-name");
      expect(jobs[0]!.exportName).toBe("myJob");
    });

    describe("verify no false positives occur", () => {
      test("function calls other than createWorkflowJob are not detected", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const notAJob = someOtherFunction({
  name: "not-a-job",
  body: async () => { return "test"; }
});

const realJob = createWorkflowJob({
  name: "real-job",
  body: async () => {}
});
`;
        const jobs = findJobs(source);

        // only createWorkflowJob calls are detected
        expect(jobs).toHaveLength(1);
        expect(jobs[0]!.name).toBe("real-job");
      });

      test("objects not passed to createWorkflowJob are not detected", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

// object with same pattern but not passed to createWorkflowJob
const config = { name: "unused-job", body: async () => {} };

// used for different purpose
doSomethingElse(config);

// real job
const realJob = createWorkflowJob({
  name: "real-job",
  body: async () => {}
});
`;
        const jobs = findJobs(source);

        // only createWorkflowJob calls are detected
        expect(jobs).toHaveLength(1);
        expect(jobs[0]!.name).toBe("real-job");
      });

      test("objects in arrays are not detected unless used with createWorkflowJob", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

// array not used with createWorkflowJob
const configs = [
  { name: "config-one", body: async () => {} },
  { name: "config-two", body: async () => {} }
];

// different usage
processConfigs(configs);
`;
        // not detected because no createWorkflowJob call exists
        expect(findJobs(source)).toHaveLength(0);
      });
    });

    describe("various import patterns", () => {
      test.each([
        [
          "aliased import",
          `
import { createWorkflowJob as create } from "@tailor-platform/sdk";

const job = create({
  name: "job-one",
  body: async () => {}
});
`,
        ],
        [
          "default import",
          `
import sdk from "@tailor-platform/sdk";

const job = sdk.createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`,
        ],
        [
          "namespace import",
          `
import * as sdk from "@tailor-platform/sdk";

const job = sdk.createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`,
        ],
        [
          "subpath import",
          `
import { createWorkflowJob } from "@tailor-platform/sdk/configure";

const job = createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`,
        ],
        [
          "dynamic import",
          `
const sdk = await import("@tailor-platform/sdk");

const job = sdk.createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`,
        ],
        [
          "require()",
          `
const { createWorkflowJob } = require("@tailor-platform/sdk");

const job = createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`,
        ],
      ])("%s", (_label, source) => {
        const jobs = findJobs(source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0]!.name).toBe("job-one");
      });
    });

    describe("false negatives (patterns that cannot be detected)", () => {
      test.each([
        [
          "cannot detect when body is a reference to a function",
          `
import { createWorkflowJob } from "@tailor-platform/sdk";

async function myHandler() { return "result"; }

const job = createWorkflowJob({
  name: "my-job",
  body: myHandler
});
`,
        ],
        [
          "cannot detect when name is a variable",
          `
import { createWorkflowJob } from "@tailor-platform/sdk";

const jobName = "my-job";

const job = createWorkflowJob({
  name: jobName,
  body: async () => {}
});
`,
        ],
        [
          "cannot detect objects composed only of spread operators",
          `
import { createWorkflowJob } from "@tailor-platform/sdk";

const nameConfig = { name: "my-job" };
const bodyConfig = { body: async () => {} };

const job = createWorkflowJob({ ...nameConfig, ...bodyConfig });
`,
        ],
        [
          "cannot detect config objects passed as variables",
          `
import { createWorkflowJob } from "@tailor-platform/sdk";

const config = { name: "my-job", body: async () => {} };

const job = createWorkflowJob(config);
`,
        ],
        [
          "cannot detect after reassignment to a variable",
          `
import { createWorkflowJob } from "@tailor-platform/sdk";

const create = createWorkflowJob;
const job = create({
  name: "job-one",
  body: async () => {}
});
`,
        ],
        [
          "cannot detect after destructuring from namespace",
          `
import * as sdk from "@tailor-platform/sdk";

const { createWorkflowJob } = sdk;
const job = createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`,
        ],
      ])("%s", (_label, source) => {
        expect(findJobs(source)).toHaveLength(0);
      });
    });
  });
});

describe("AST Transformer - transformation logic", () => {
  describe("transformWorkflowSource", () => {
    test("transforms start calls to execJobFunction", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const fetchData = createWorkflowJob({
  name: "fetch-data",
  body: async () => ({ data: "test" })
});

const mainJob = createWorkflowJob({
  name: "main-job",
  body: async (input, { env }) => {
    const result = await fetchData.start({ id: input.id });
    return result;
  }
});
`;
      const allJobsMap = new Map<string, string>([
        ["fetchData", "fetch-data"],
        ["mainJob", "main-job"],
      ]);
      const result = transformWorkflowJobSource(
        source,
        "main-job",
        "mainJob",
        ["fetchData"],
        allJobsMap,
      );

      expect(result).toContain('tailor.workflow.execJobFunction("fetch-data", { id: input.id })');
      // fetchData declaration is removed (const fetchData = ...)
      expect(result).not.toContain("const fetchData");
    });

    test("starts the job under the name the context gives its job function", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const fetchData = createWorkflowJob({ name: "fetch-data", body: async () => ({}) });

const mainJob = createWorkflowJob({
  name: "main-job",
  body: async (input) => await fetchData.start({ id: input.id }),
});
`;
      const file = path.resolve("test.ts");
      const target = { kind: "job", name: "fetch-data" } as const;
      const context: StartContext = {
        modules: new Map([
          [
            normalizeFilePath(file),
            {
              sourceFile: file,
              localBindings: new Map([["fetchData", target]]),
              exports: new Map([["fetchData", target]]),
            },
          ],
        ]),
        jobFunctionName: (jobName) => `tmp-run-r1-${jobName}`,
      };

      const result = transformStartCallsWithContext(source, context, file).toString();

      expect(result).toContain('tailor.workflow.execJobFunction("tmp-run-r1-fetch-data", ');
    });

    test("forwards a second options argument to execJobFunction", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const fetchData = createWorkflowJob({
  name: "fetch-data",
  body: async () => ({ data: "test" })
});

const mainJob = createWorkflowJob({
  name: "main-job",
  body: async (input) => {
    return await fetchData.start({ id: input.id }, { executionPolicyKey: "premium" });
  }
});
`;
      const allJobsMap = new Map<string, string>([
        ["fetchData", "fetch-data"],
        ["mainJob", "main-job"],
      ]);
      const result = transformWorkflowJobSource(
        source,
        "main-job",
        "mainJob",
        ["fetchData"],
        allJobsMap,
      );

      expect(result).toContain(
        'tailor.workflow.execJobFunction("fetch-data", { id: input.id }, { executionPolicyKey: "premium" })',
      );
    });

    test("completely removes other job declarations", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const heavyJob = createWorkflowJob({
  name: "heavy-job",
  body: async () => {
    const db = getDB("tailordb");
    return await db.selectFrom("User").execute();
  }
});

const mainJob = createWorkflowJob({
  name: "main-job",
  body: async (input, { env }) => {
    const result = await heavyJob.start();
    return { result: "main" };
  }
});
`;
      const allJobsMap = new Map<string, string>([
        ["heavyJob", "heavy-job"],
        ["mainJob", "main-job"],
      ]);
      const result = transformWorkflowJobSource(
        source,
        "main-job",
        "mainJob",
        ["heavyJob"],
        allJobsMap,
      );

      // heavyJob declaration is completely removed (const heavyJob = createWorkflowJob(...))
      expect(result).not.toContain("const heavyJob");
      // getDB is removed (part of heavyJob body)
      expect(result).not.toContain("getDB");
      // mainJob body is preserved
      expect(result).toContain('result: "main"');
      // start is transformed (job name appears in execJobFunction call)
      expect(result).toContain('tailor.workflow.execJobFunction("heavy-job", undefined)');
    });

    test("removes declarations of multiple other jobs", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const job1 = createWorkflowJob({
  name: "job-one",
  body: () => "heavy code 1"
});

const job2 = createWorkflowJob({
  name: "job-two",
  body: () => "heavy code 2"
});

const mainJob = createWorkflowJob({
  name: "main-job",
  body: async () => {
    await job1.start();
    await job2.start();
    return "main";
  }
});
`;
      const allJobsMap = new Map<string, string>([
        ["job1", "job-one"],
        ["job2", "job-two"],
        ["mainJob", "main-job"],
      ]);
      const result = transformWorkflowJobSource(
        source,
        "main-job",
        "mainJob",
        ["job1", "job2"],
        allJobsMap,
      );

      // job1, job2 declarations are removed (const job1 = ..., const job2 = ...)
      expect(result).not.toContain("const job1");
      expect(result).not.toContain("const job2");
      // mainJob body is preserved
      expect(result).toContain('"main"');
      // heavy code is removed (part of job1/job2 body)
      expect(result).not.toContain("heavy code");
      // starts are transformed (job names appear in execJobFunction calls)
      expect(result).toContain('tailor.workflow.execJobFunction("job-one", undefined)');
      expect(result).toContain('tailor.workflow.execJobFunction("job-two", undefined)');
    });

    test("does not transform start calls inside fallback-removed job bodies", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const nestedJob = createWorkflowJob({
  name: "nested-job",
  body: () => "nested"
});

createWorkflowJob({
  name: "fallback-job",
  body: async () => {
    await nestedJob.start({ id: 1 });
    return "fallback";
  }
});

const mainJob = createWorkflowJob({
  name: "main-job",
  body: async () => "main"
});
`;
      const result = transformWorkflowSource(source, "main-job").toString();

      expect(result).toContain("body: () => {}");
      expect(result).not.toContain("nestedJob.start");
      expect(result).not.toContain("execJobFunction");
    });

    test("does not modify jobs without start calls", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const simpleJob = createWorkflowJob({
  name: "simple-job",
  body: () => "simple"
});
`;
      const result = transformWorkflowSource(source, "simple-job").toString();

      // no changes
      expect(result).toContain('"simple"');
    });

    test("does not remove a nested variable that matches another module's job export", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: async () => {
    const step = { start: async () => "local" };
    return await step.start();
  },
});
`;

      const result = transformWorkflowSource(source, "main-job", "mainJob", ["step"]).toString();

      expect(result).toContain('const step = { start: async () => "local" }');
      expect(result).toContain("step.start()");
    });

    test("removes createWorkflow default export", () => {
      const source = `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const check_inventory = createWorkflowJob({
  name: "check-inventory",
  body: () => "inventory checked"
});

export const validate_order = createWorkflowJob({
  name: "validate-order",
  body: (input) => {
    const inventoryResult = check_inventory.start();
    return { inventoryResult };
  }
});

export default createWorkflow({
  name: "sample-workflow",
  mainJob: validate_order,
});
`;
      // When bundling check-inventory job
      const result = transformWorkflowSource(source, "check-inventory").toString();

      // check-inventory should remain
      expect(result).toContain("check-inventory");
      expect(result).toContain("inventory checked");

      // validate_order should be removed
      expect(result).not.toContain("validate-order");

      // createWorkflow default export should be removed
      expect(result).not.toContain("export default");
      expect(result).not.toContain("sample-workflow");
    });

    test("removes createWorkflow with identifier reference default export", () => {
      const source = `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const mainJob = createWorkflowJob({
  name: "main-job",
  body: () => "main"
});

const workflow = createWorkflow({
  name: "my-workflow",
  mainJob,
});

export default workflow;
`;
      const result = transformWorkflowSource(source, "main-job").toString();

      // mainJob should remain
      expect(result).toContain("main-job");

      // workflow identifier default export should be removed
      expect(result).not.toContain("export default");
    });

    test("preserves default export in dependency files where target job does not exist", () => {
      // This simulates the scenario where the bundler transforms a dependency
      // file (e.g. simple.ts imported by caller.ts via default import).
      // The target job "caller-job" does not exist in this file, so the
      // default export must be preserved for the importing file to resolve it.
      const source = `
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
`;
      // "caller-job" is the target job being bundled, but it does NOT exist
      // in this file. This file is a dependency imported by the caller.
      const result = transformWorkflowSource(source, "caller-job").toString();

      // The default export must be preserved so that the importing file
      // can resolve `import simpleWorkflow from "./simple"`
      expect(result).toContain("export default");
    });
  });
});

describe("AST Transformer - workflow detection", () => {
  describe("findAllWorkflows", () => {
    test("detects createWorkflow calls", () => {
      const source = `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const mainJob = createWorkflowJob({
  name: "main-job",
  body: async () => ({ result: "test" })
});

const myWorkflow = createWorkflow({
  name: "my-workflow",
  mainJob: mainJob
});
`;
      const workflows = findWorkflows(source);

      expect(workflows).toHaveLength(1);
      expect(workflows[0]!.name).toBe("my-workflow");
      expect(workflows[0]!.exportName).toBe("myWorkflow");
    });

    test("detects default exported workflow", () => {
      const source = `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const mainJob = createWorkflowJob({
  name: "main-job",
  body: async () => ({})
});

export default createWorkflow({
  name: "default-workflow",
  mainJob: mainJob
});
`;
      const workflows = findWorkflows(source);

      expect(workflows).toHaveLength(1);
      expect(workflows[0]!.name).toBe("default-workflow");
      expect(workflows[0]!.isDefaultExport).toBe(true);
    });

    test("detects multiple workflows", () => {
      const source = `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const job1 = createWorkflowJob({ name: "job1", body: async () => ({}) });
const job2 = createWorkflowJob({ name: "job2", body: async () => ({}) });

const workflow1 = createWorkflow({ name: "workflow-one", mainJob: job1 });
const workflow2 = createWorkflow({ name: "workflow-two", mainJob: job2 });
`;
      const workflows = findWorkflows(source);

      expect(workflows).toHaveLength(2);
      expect(workflows[0]!.name).toBe("workflow-one");
      expect(workflows[1]!.name).toBe("workflow-two");
    });
  });
});

describe("AST Transformer - transformStartCalls", () => {
  describe("workflow start transformation", () => {
    test("transforms workflow.start() calls to globalThis.tailor.workflow.startWorkflow()", () => {
      const source = `
const workflowRunId = await orderWorkflow.start(
  { orderId: "123", customerId: "456" },
  { invoker: "admin" }
);
`;
      const workflowNameMap = new Map([["orderWorkflow", "order-processing"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      expect(result).toContain('await globalThis.tailor.workflow.startWorkflow("order-processing"');
      expect(result).toContain('{ orderId: "123", customerId: "456" }');
      expect(result).toContain('{ invoker: "admin" }');
    });

    test("transforms workflow.start() without options and omits the helper", () => {
      const source = `
const result = await myWorkflow.start({ id: 1 });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      expect(result).toContain('tailor.workflow.startWorkflow("my-workflow", { id: 1 })');
      expect(result).not.toContain("__tailor_normalizeStartOptions");
    });

    test("wraps a string-literal invoker with the runtime normalizer when authNamespace is provided", () => {
      const source = `
const result = await myWorkflow.start({ id: 1 }, { invoker: "kiosk" });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      expect(result).toContain('tailor.workflow.startWorkflow("my-workflow"');
      expect(result).toContain('__tailor_normalizeStartOptions({ invoker: "kiosk" })');
      // Helper injected at the top of the file with the namespace baked in
      expect(result).toContain(
        'const __tailor_normalizeStartOptions = (o) => { if (!o) return o; const { invoker, ...rest } = o; return typeof invoker === "string" ? { ...rest, authInvoker: { namespace: "my-auth", machineUserName: invoker } } : typeof invoker === "object" ? { ...rest, authInvoker: invoker } : o; };',
      );
    });

    test("wraps a variable-reference invoker with the runtime normalizer", () => {
      const source = `
const machineUser = "kiosk";
const result = await myWorkflow.start({ id: 1 }, { invoker: machineUser });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      expect(result).toContain("__tailor_normalizeStartOptions({ invoker: machineUser })");
    });

    test("wraps a shorthand invoker with the runtime normalizer", () => {
      const source = `
const invoker = "kiosk";
const result = await myWorkflow.start({ id: 1 }, { invoker });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      expect(result).toContain("__tailor_normalizeStartOptions({ invoker })");
    });

    test("wraps a variable options argument with the runtime normalizer", () => {
      const source = `
const opts = { invoker: "kiosk" };
const result = await myWorkflow.start({ id: 1 }, opts);
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      expect(result).toContain(
        'tailor.workflow.startWorkflow("my-workflow", { id: 1 }, __tailor_normalizeStartOptions(opts))',
      );
    });

    test("wraps spread options with the runtime normalizer", () => {
      const source = `
const result = await myWorkflow.start({ id: 1 }, { ...base });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      expect(result).toContain("__tailor_normalizeStartOptions({ ...base })");
    });

    test("transforms workflow.start() with an empty options object", () => {
      const source = `
const result = await myWorkflow.start({ id: 1 }, {});
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      expect(result).toContain(
        'tailor.workflow.startWorkflow("my-workflow", { id: 1 }, __tailor_normalizeStartOptions({}))',
      );
    });

    test("injects the normalizer helper only once per file even for multiple start calls", () => {
      const source = `
await myWorkflow.start({ id: 1 }, { invoker: "kiosk" });
await myWorkflow.start({ id: 2 }, { invoker: "batch" });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      const matches = result.match(/const __tailor_normalizeStartOptions =/g);
      expect(matches).toHaveLength(1);
    });

    test("maps an object invoker to authInvoker when authNamespace is not provided", async () => {
      const source = `
await myWorkflow.start({ id: 1 }, { invoker: { namespace: "other-auth", machineUserName: "kiosk" } });
`;
      const result = transformStartCalls(
        source,
        new Map([["myWorkflow", "my-workflow"]]),
        new Map<string, string>(),
      );
      const startWorkflow = vi.fn(async () => "run-id");
      vi.stubGlobal("tailor", { workflow: { startWorkflow } });
      using dir = tempDir("start-object-invoker-");
      const file = path.join(dir.dir, "start.mjs");
      fs.writeFileSync(file, result);
      try {
        await import(file);
      } finally {
        vi.unstubAllGlobals();
      }

      expect(startWorkflow.mock.calls).toEqual([
        [
          "my-workflow",
          { id: 1 },
          { authInvoker: { namespace: "other-auth", machineUserName: "kiosk" } },
        ],
      ]);
    });
  });
  describe("workflow start invokers in a config without an Auth service", () => {
    const transform = (options: string) =>
      transformStartCalls(
        `await myWorkflow.start({ id: 1 }, ${options});`,
        new Map([["myWorkflow", "my-workflow"]]),
        new Map<string, string>(),
      );

    test("rejects a string literal invoker, naming the file", () => {
      let thrown: unknown;
      try {
        transform('{ invoker: "kiosk" }');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        code: "WORKFLOW_START_INVOKER_AUTH_REQUIRED",
        message: 'myWorkflow.start() runs as "kiosk", but the config has no Auth service.',
        suggestion: expect.stringContaining('{ namespace: "<auth>", machineUserName: "kiosk" }'),
      });
      expect(getErrorDiagnostics(thrown as Error).location).toEqual({
        file: path.resolve("test.ts"),
      });
    });

    test.for([
      "undefined",
      "{ invoker: undefined }",
      "{ invoker: machineUser }",
      "options",
      "{ ...defaults }",
    ])("passes %s to the runtime normalizer", (options) => {
      expect(transform(options)).toContain(`__tailor_normalizeStartOptions(${options})`);
    });

    test("names a start through a namespace import as it is written", () => {
      const source = `
import * as order from "./order";
await order.default.start({ id: 1 }, { invoker: "kiosk" });
`;
      expect(() =>
        transformStartCalls(
          source,
          new Map(),
          new Map(),
          new Map([[path.resolve("order.ts"), "order"]]),
        ),
      ).toThrow(
        expect.objectContaining({ message: expect.stringMatching(/^order\.default\.start\(\) /) }),
      );
    });
  });
  describe("workflow start invokers in a config with several Auth services", () => {
    const machineUserAuthNamespaces = new Map([
      ["batch", ["admin-auth"]],
      ["seeder", ["shop-auth", "admin-auth"]],
    ]);
    const transform = (options: string) =>
      transformStartCalls(
        `await myWorkflow.start({ id: 1 }, ${options});`,
        new Map([["myWorkflow", "my-workflow"]]),
        new Map<string, string>(),
        undefined,
        undefined,
        undefined,
        machineUserAuthNamespaces,
      );

    test("names the Auth service of a string literal invoker that one Auth service defines", async () => {
      const result = transform('{ invoker: "batch" }');
      const startWorkflow = vi.fn(async () => "run-id");
      vi.stubGlobal("tailor", { workflow: { startWorkflow } });
      using dir = tempDir("start-literal-invoker-");
      const file = path.join(dir.dir, "start.mjs");
      fs.writeFileSync(file, result);
      try {
        await import(file);
      } finally {
        vi.unstubAllGlobals();
      }

      expect(startWorkflow).toHaveBeenCalledWith(
        "my-workflow",
        { id: 1 },
        { authInvoker: { namespace: "admin-auth", machineUserName: "batch" } },
      );
    });

    test.for([
      { invoker: '"seeder"', code: "WORKFLOW_START_INVOKER_AMBIGUOUS" },
      { invoker: '"ghost"', code: "WORKFLOW_START_INVOKER_NOT_FOUND" },
      { invoker: "machineUser", code: "WORKFLOW_START_INVOKER_UNRESOLVED" },
    ])("rejects the invoker $invoker", ({ invoker, code }) => {
      expect(() => transform(`{ invoker: ${invoker} }`)).toThrow(expect.objectContaining({ code }));
    });

    test("rejects options it cannot read, naming the file", () => {
      let thrown: unknown;
      try {
        transform("options");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ code: "WORKFLOW_START_INVOKER_UNRESOLVED" });
      expect(getErrorDiagnostics(thrown as Error).location).toEqual({
        file: path.resolve("test.ts"),
      });
    });

    test.for([
      '{ invoker: "batch" as const }',
      '{ invoker: ("batch") }',
      "{ invoker: `batch` }",
      '({ invoker: "batch" }) satisfies object',
      '{ ...defaults, invoker: "batch" }',
    ])("names the Auth service of the static invoker in %s", (options) => {
      expect(transform(options)).toContain('{ namespace: "admin-auth", machineUserName: "batch" }');
    });

    test.for(["undefined", "{ invoker: undefined }"])("accepts %s", (options) => {
      expect(() => transform(options)).not.toThrow();
    });

    test("rejects spread options without an invoker of their own", () => {
      expect(() => transform("{ ...defaults }")).toThrow(
        expect.objectContaining({ code: "WORKFLOW_START_INVOKER_UNRESOLVED" }),
      );
    });

    test("keeps an invoker that names its Auth service", () => {
      expect(() =>
        transform('{ invoker: { namespace: "shop-auth", machineUserName: "seeder" } }'),
      ).not.toThrow();
    });
  });
  describe("job start transformation", () => {
    test("transforms job.start() calls to globalThis.tailor.workflow.execJobFunction()", () => {
      const source = `
const result = await fetchCustomer.start({ customerId: "123" });
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain('await globalThis.tailor.workflow.execJobFunction("fetch-customer"');
      expect(result).toContain('{ customerId: "123" }');
    });

    test("transforms job.start() without arguments", () => {
      const source = `
const result = await simpleJob.start();
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["simpleJob", "simple-job"]]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain('tailor.workflow.execJobFunction("simple-job", undefined)');
    });

    test("forwards a second options argument to execJobFunction", () => {
      const source = `
const result = await fetchCustomer.start({ id: "123" }, { executionPolicyKey: "premium" });
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain(
        'tailor.workflow.execJobFunction("fetch-customer", { id: "123" }, { executionPolicyKey: "premium" })',
      );
    });

    test("omits the options argument when the caller passes only args", () => {
      const source = `
const result = await fetchCustomer.start({ id: "123" });
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      // Args only, no trailing options argument.
      expect(result).toContain('tailor.workflow.execJobFunction("fetch-customer", { id: "123" })');
      expect(result).not.toContain('{ id: "123" }, ');
    });
  });

  describe("false positive prevention", () => {
    test("does not transform .start() calls on unknown identifiers", () => {
      const source = `
// This should NOT be transformed
const result = await someRandomObject.start({ data: "test" });

// Neither should this
const event = button.start("click");
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      // Should remain unchanged
      expect(result).toContain('someRandomObject.start({ data: "test" })');
      expect(result).toContain('button.start("click")');
      expect(result).not.toContain("tailor.workflow");
    });

    test("only transforms start calls for known workflows and jobs", () => {
      const source = `
// Known workflow - should be transformed
const wfResult = await orderWorkflow.start({ id: 1 }, { invoker: "admin" });

// Known job - should be transformed
const jobResult = await fetchData.start({ id: 2 });

// Unknown - should NOT be transformed
const unknown = await randomThing.start({ id: 3 });
`;
      const workflowNameMap = new Map([["orderWorkflow", "order-processing"]]);
      const jobNameMap = new Map([["fetchData", "fetch-data"]]);

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      // Known workflow transformed
      expect(result).toContain('tailor.workflow.startWorkflow("order-processing"');
      // Known job transformed
      expect(result).toContain('tailor.workflow.execJobFunction("fetch-data"');
      // Unknown NOT transformed
      expect(result).toContain("randomThing.start({ id: 3 })");
    });

    test("transforms workflow.start() regardless of argument count", () => {
      const source = `
const result = await myWorkflow.start({ id: 1 });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain('tailor.workflow.startWorkflow("my-workflow", { id: 1 })');
      expect(result).not.toContain("myWorkflow.start");
    });
  });

  describe("start targets reached through imports", () => {
    let tmpDir: string | undefined;

    aroundEach(async (runTest) => {
      await runTest();
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
      }
    });

    const projectFiles: Record<string, string> = {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "src/workflows/sub.ts": `
import { createWorkflowJob } from "@tailor-platform/sdk";
export const sub = createWorkflowJob({ name: "sub-job", body: async () => "sub" });
`,
      "src/workflows/nested/index.ts": `
import { createWorkflowJob } from "@tailor-platform/sdk";
export const nested = createWorkflowJob({ name: "nested-job", body: async () => "nested" });
`,
      "src/workflows/sync.ts": `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
export const syncStep = createWorkflowJob({ name: "sync-step", body: async () => "sync" });
export const syncWorkflow = createWorkflow({ name: "sync-workflow", mainJob: syncStep });
export default syncWorkflow;
`,
      "src/workflows/barrel.ts": `export { sub } from "./sub";\n`,
      "src/workflows/made.ts": `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
const step = createWorkflowJob({ name: "made-step", body: async () => "made" });
const make = (name: string) => createWorkflow({ name, mainJob: step });
export default make("made-workflow");
`,
      "src/lib/server.ts": `export const server = { start: () => "started" };\n`,
    };
    const workflowFiles = [
      "src/workflows/sub.ts",
      "src/workflows/nested/index.ts",
      "src/workflows/sync.ts",
    ];

    type ProjectOptions = {
      /** List the files through a symlink to the project directory. */
      listedThroughSymlink?: boolean;
      /** List the files relative to the working directory, outside the config directory, as v1 configs did. */
      listedRelativeToCwd?: boolean;
    };

    async function transformInProject(
      source: string,
      listedFiles: readonly string[],
      options: ProjectOptions = {},
    ) {
      tmpDir = makeTempDir("start-import-test-");
      for (const [file, content] of Object.entries(projectFiles)) {
        fs.mkdirSync(path.dirname(path.join(tmpDir, file)), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, file), content);
      }
      const dir = tmpDir;
      const listedRoot = options.listedThroughSymlink ? path.join(dir, "link") : dir;
      if (options.listedThroughSymlink) fs.symlinkSync(dir, listedRoot, "dir");
      const originalCwd = process.cwd();
      if (options.listedRelativeToCwd) process.chdir(dir);
      const context = await buildStartContext(
        {
          files: options.listedRelativeToCwd
            ? [...listedFiles]
            : listedFiles.map((file) => path.join(listedRoot, file)),
        },
        undefined,
        options.listedRelativeToCwd ? path.join(dir, "config") : listedRoot,
      ).finally(() => process.chdir(originalCwd));
      const callerFile = path.join(dir, "src/caller.ts");
      return { callerFile, run: () => transformStartCallsWithContext(source, context, callerFile) };
    }

    const reachPaths = [
      {
        name: "a relative named import",
        source: `import { sub } from "./workflows/sub";\nawait sub.start({ id: 1 });`,
        rewritten: 'tailor.workflow.execJobFunction("sub-job", { id: 1 })',
        failure: { callee: "sub.start", importSource: "./workflows/sub", targetName: "sub-job" },
      },
      {
        name: "a renamed named import",
        source: `import { sub as child } from "./workflows/sub";\nawait child.start({ id: 1 });`,
        rewritten: 'tailor.workflow.execJobFunction("sub-job", { id: 1 })',
        failure: { callee: "child.start", importedName: "sub", targetName: "sub-job" },
      },
      {
        name: "a .js specifier",
        source: `import { sub } from "./workflows/sub.js";\nawait sub.start({ id: 1 });`,
        rewritten: 'tailor.workflow.execJobFunction("sub-job", { id: 1 })',
        failure: { importSource: "./workflows/sub.js", targetName: "sub-job" },
      },
      {
        name: "a tsconfig paths alias",
        source: `import { sub } from "@/workflows/sub";\nawait sub.start({ id: 1 });`,
        rewritten: 'tailor.workflow.execJobFunction("sub-job", { id: 1 })',
        failure: { importSource: "@/workflows/sub", targetName: "sub-job" },
      },
      {
        name: "a directory index",
        source: `import { nested } from "./workflows/nested";\nawait nested.start({ id: 1 });`,
        rewritten: 'tailor.workflow.execJobFunction("nested-job", { id: 1 })',
        failure: { importSource: "./workflows/nested", targetName: "nested-job" },
      },
      {
        name: "a tsconfig paths alias to a directory index",
        source: `import { nested } from "@/workflows/nested";\nawait nested.start({ id: 1 });`,
        rewritten: 'tailor.workflow.execJobFunction("nested-job", { id: 1 })',
        failure: { importSource: "@/workflows/nested", targetName: "nested-job" },
      },
      {
        name: "a namespace import",
        source: `import * as jobs from "./workflows/sub";\nawait jobs.sub.start({ id: 1 });`,
        rewritten: 'tailor.workflow.execJobFunction("sub-job", { id: 1 })',
        failure: {
          callee: "jobs.sub.start",
          importSource: "./workflows/sub",
          importedName: "sub",
          targetName: "sub-job",
        },
      },
      {
        name: "a default import of a workflow",
        source: `import sync from "./workflows/sync";\nawait sync.start({ id: 1 });`,
        rewritten: 'tailor.workflow.startWorkflow("sync-workflow", { id: 1 })',
        failure: { importedName: "default", kind: "workflow", targetName: "sync-workflow" },
      },
      {
        name: "a named import of a workflow",
        source: `import { syncWorkflow } from "@/workflows/sync";\nawait syncWorkflow.start({ id: 1 });`,
        rewritten: 'tailor.workflow.startWorkflow("sync-workflow", { id: 1 })',
        failure: { importedName: "syncWorkflow", kind: "workflow", targetName: "sync-workflow" },
      },
    ];

    test.for(reachPaths)(
      "rewrites .start() reached through $name when the file is in files",
      async ({ source, rewritten }) => {
        const { run } = await transformInProject(source, workflowFiles);

        const result = run().toString();

        expect(result).toContain(rewritten);
        expect(result).not.toContain(".start(");
      },
    );

    test.for(reachPaths)(
      "fails the build on .start() reached through $name when the file is not in files",
      async ({ source, failure }) => {
        const { run } = await transformInProject(source, []);

        expect(run).toThrow(
          expect.objectContaining({
            code: "WORKFLOW_START_TARGET_OUTSIDE_FILES",
            context: expect.objectContaining(failure),
          }),
        );
      },
    );

    test("names the call, the target, and its file when the file is not in files", async () => {
      const { run, callerFile } = await transformInProject(
        `import { sub } from "./workflows/sub";\nawait sub.start({ id: 1 });`,
        [],
      );
      const targetFile = path.join(path.dirname(callerFile), "workflows/sub.ts");
      const displayFile = path.relative(process.cwd(), targetFile);

      let thrown: unknown;
      try {
        run();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        code: "WORKFLOW_START_TARGET_OUTSIDE_FILES",
        message: `sub.start() cannot be rewritten: job "sub-job" is defined in ${displayFile}, which the config's workflow "files" do not include.`,
        suggestion: `Add src/workflows/sub.ts to the workflow "files" in the config (add a workflow service if it has none), or remove the "!" pattern or "ignores" entry that leaves it out.`,
        context: {
          file: callerFile,
          callee: "sub.start",
          importSource: "./workflows/sub",
          importedName: "sub",
          kind: "job",
          targetName: "sub-job",
          targetFile,
        },
      });
      expect(getErrorDiagnostics(thrown as Error).location).toEqual({ file: callerFile });
    });

    test("suggests the entry relative to the working directory when the files fall back to it", async () => {
      using _warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const { run } = await transformInProject(
        `import { sub } from "./workflows/sub";\nawait sub.start({ id: 1 });`,
        ["src/workflows/sync.ts"],
        { listedRelativeToCwd: true },
      );

      expect(run).toThrow(
        expect.objectContaining({
          suggestion: expect.stringContaining('Add src/workflows/sub.ts to the workflow "files"'),
        }),
      );
    });

    test("does not report a file in files that the import reaches through another path", async () => {
      const { run } = await transformInProject(
        `import { sub } from "./workflows/sub";\nawait sub.start({ id: 1 });`,
        workflowFiles,
        { listedThroughSymlink: true },
      );

      expect(run).not.toThrow();
    });

    test("fails the build on .start() of a job the calling file defines when that file is not in files", async () => {
      const { run, callerFile } = await transformInProject(
        `import { createWorkflowJob } from "@tailor-platform/sdk";
export const notify = createWorkflowJob({ name: "notify-job", body: async () => "notify" });
export const run = async () => await notify.start();`,
        [],
      );

      expect(run).toThrow(
        expect.objectContaining({
          code: "WORKFLOW_START_TARGET_OUTSIDE_FILES",
          suggestion: expect.stringContaining('Add src/caller.ts to the workflow "files"'),
          context: expect.objectContaining({
            file: callerFile,
            callee: "notify.start",
            importSource: undefined,
            kind: "job",
            targetName: "notify-job",
            targetFile: callerFile,
          }),
        }),
      );
    });

    test("leaves .start() on a parameter that shadows a job the calling file defines untouched", async () => {
      const { run } = await transformInProject(
        `import { createWorkflowJob } from "@tailor-platform/sdk";
export const notify = createWorkflowJob({ name: "notify-job", body: async () => "notify" });
export const run = (notify: { start(): void }) => notify.start();`,
        [],
      );

      expect(run().toString()).toContain("notify.start()");
    });

    test.for([
      {
        name: "a re-export from another file",
        source: `import { sub } from "./workflows/barrel";\nawait sub.start({ id: 1 });`,
        call: "sub.start({ id: 1 })",
      },
      {
        name: "a workflow a helper function creates",
        source: `import made from "./workflows/made";\nawait made.start({ id: 1 });`,
        call: "made.start({ id: 1 })",
      },
      {
        name: "an object that is not a workflow or job",
        source: `import { server } from "./lib/server";\nserver.start();`,
        call: "server.start()",
      },
      {
        name: "an import that resolves to no file",
        source: `import missing from "@/workflows/missing";\nawait missing.start({ id: 1 });`,
        call: "missing.start({ id: 1 })",
      },
      {
        name: "a binding a parameter shadows",
        source: `import { sub } from "./workflows/sub";\nexport const run = (sub: { start(): void }) => sub.start();`,
        call: "sub.start()",
      },
    ])(
      "leaves .start() on $name untouched when its file is not in files",
      async ({ source, call }) => {
        const { run } = await transformInProject(source, []);

        expect(run().toString()).toContain(call);
      },
    );
  });

  describe("undetectable workflow-file imports", () => {
    function thrownBy(run: () => unknown): Error {
      try {
        run();
      } catch (error) {
        return error as Error;
      }
      throw new Error("expected a throw");
    }

    const callerFile = path.resolve("src/resolvers/run.ts");
    const syncFile = path.resolve("src/workflow/sync.ts");
    const context: StartContext = {
      modules: new Map([
        [
          normalizeFilePath(syncFile),
          {
            sourceFile: syncFile,
            localBindings: new Map(),
            exports: new Map([["syncStep", { kind: "job", name: "sync-step" }]]),
          },
        ],
      ]),
    };

    test("throws when .start() is called on a named export the build cannot detect", () => {
      const source = `
import { syncWorkflow } from "../workflow/sync";

export async function run() {
  return await syncWorkflow.start({ id: 1 });
}
`;

      const thrown = thrownBy(() => transformStartCallsWithContext(source, context, callerFile));
      expect(thrown).toMatchObject({
        code: "WORKFLOW_START_TARGET_UNDETECTABLE",
        message:
          'syncWorkflow.start() cannot be rewritten: "../workflow/sync" is a workflow file, but its export "syncWorkflow" is not a workflow or job the build can detect.',
        context: {
          file: callerFile,
          importSource: "../workflow/sync",
          importedName: "syncWorkflow",
        },
      });
      expect(getErrorDiagnostics(thrown).location).toEqual({ file: callerFile });
    });

    test("transforms .start() on a detectable export reached through a namespace import", () => {
      const source = `
import * as sync from "../workflow/sync";

export async function run() {
  return await sync.syncStep.start({ id: 1 });
}
`;

      expect(transformStartCallsWithContext(source, context, callerFile).toString()).toContain(
        'tailor.workflow.execJobFunction("sync-step", { id: 1 })',
      );
    });

    test("throws when .start() is called through a namespace import on an export the build cannot detect", () => {
      const source = `
import * as sync from "../workflow/sync";

export async function run() {
  return await sync.default.start({ id: 1 });
}
`;

      expect(
        thrownBy(() => transformStartCallsWithContext(source, context, callerFile)),
      ).toMatchObject({
        code: "WORKFLOW_START_TARGET_UNDETECTABLE",
        message:
          'sync.default.start() cannot be rewritten: "../workflow/sync" is a workflow file, but its default export is not a workflow or job the build can detect.',
      });
    });

    test("does not throw when the undetectable import is shadowed by a local binding", () => {
      const source = `
import { syncWorkflow } from "../workflow/sync";

export async function run(syncWorkflow: { start(input: unknown): Promise<string> }) {
  return await syncWorkflow.start({ id: 1 });
}
`;

      expect(transformStartCallsWithContext(source, context, callerFile).toString()).toContain(
        "syncWorkflow.start({ id: 1 })",
      );
    });

    test.each([
      [
        "a switch case",
        `export function run(kind: string) {
  switch (kind) {
    case "local":
      const syncWorkflow = { start: (input: unknown) => input };
      return syncWorkflow.start({ id: 1 });
  }
}`,
      ],
      [
        "a named class expression",
        `export const Runner = class syncWorkflow {
  static start(input: unknown) { return input; }
  static run() { return syncWorkflow.start({ id: 1 }); }
};`,
      ],
      [
        "a namespace",
        `export namespace Local {
  const syncWorkflow = { start: (input: unknown) => input };
  export const run = () => syncWorkflow.start({ id: 1 });
}`,
      ],
      [
        "a static block",
        `export class Runner {
  static result: unknown;
  static {
    const syncWorkflow = { start: (input: unknown) => input };
    Runner.result = syncWorkflow.start({ id: 1 });
  }
}`,
      ],
    ])("does not throw when the undetectable import is shadowed in %s", (_, body) => {
      const source = `import { syncWorkflow } from "../workflow/sync";\n\n${body}\n`;

      expect(transformStartCallsWithContext(source, context, callerFile).toString()).toContain(
        "syncWorkflow.start({ id: 1 })",
      );
    });

    test("does not throw when the namespace import is shadowed by a local binding", () => {
      const source = `
import * as sync from "../workflow/sync";

export async function run(sync: { default: { start(input: unknown): Promise<string> } }) {
  return await sync.default.start({ id: 1 });
}
`;

      expect(transformStartCallsWithContext(source, context, callerFile).toString()).toContain(
        "sync.default.start({ id: 1 })",
      );
    });
  });

  describe("mixed workflow and job starts", () => {
    test("transforms both workflow and job starts in the same source", () => {
      const source = `
async function processOrder(orderId: string) {
  // Start a job to fetch data
  const data = await fetchCustomer.start({ id: orderId });

  // Then start a workflow for processing
  const workflowRunId = await orderWorkflow.start(
    { orderId, data },
    { invoker: "system" }
  );

  return { data, workflowRunId };
}
`;
      const workflowNameMap = new Map([["orderWorkflow", "order-processing"]]);
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      expect(result).toContain('tailor.workflow.execJobFunction("fetch-customer"');
      expect(result).toContain('tailor.workflow.startWorkflow("order-processing"');
    });
  });

  describe("direct job start transformation", () => {
    test("replaces job.start() with execJobFunction() and preserves await", () => {
      const source = `
const customer = await fetchCustomer.start({ customerId: "123" });
console.log(customer);
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain(
        'const customer = await globalThis.tailor.workflow.execJobFunction("fetch-customer", { customerId: "123" })',
      );
    });

    test("replaces multiple job.start() calls directly", () => {
      const source = `
const customer = await fetchCustomer.start({ customerId: "123" });
const notification = await sendNotification.start({ message: "Hello" });
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([
        ["fetchCustomer", "fetch-customer"],
        ["sendNotification", "send-notification"],
      ]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain('tailor.workflow.execJobFunction("fetch-customer"');
      expect(result).toContain('tailor.workflow.execJobFunction("send-notification"');
    });

    test("does not wrap workflow.start() calls (already async)", () => {
      const source = `
const executionId = await orderWorkflow.start({ orderId: "123" }, { invoker });
`;
      const workflowNameMap = new Map([["orderWorkflow", "order-processing"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(
        source,
        workflowNameMap,
        jobNameMap,
        undefined,
        undefined,
        "my-auth",
      );

      expect(result).toContain('await globalThis.tailor.workflow.startWorkflow("order-processing"');
      expect(result).not.toContain("(async () => globalThis.tailor.workflow.startWorkflow");
    });

    test("replaces job.start() without await with the raw platform result", () => {
      const source = `
const customerPromise = fetchCustomer.start({ customerId: "123" });
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain(
        'const customerPromise = globalThis.tailor.workflow.execJobFunction("fetch-customer", { customerId: "123" })',
      );
      expect(result).not.toMatch(/\bawait\b/);
    });

    test("replaces job.start() inside Promise.all array elements", () => {
      const source = `
const [customer, notification] = await Promise.all([
  fetchCustomer.start({ customerId: "123" }),
  sendNotification.start({ message: "Hello" }),
]);
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([
        ["fetchCustomer", "fetch-customer"],
        ["sendNotification", "send-notification"],
      ]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain(
        'tailor.workflow.execJobFunction("fetch-customer", { customerId: "123" })',
      );
      expect(result).toContain(
        'tailor.workflow.execJobFunction("send-notification", { message: "Hello" })',
      );
      expect(result).toContain("await Promise.all([");
    });

    test("replaces job.start() before .then() chains without preserving Promise wrapping", () => {
      const source = `
fetchCustomer.start({ customerId: "123" }).then((customer) => {
  console.log(customer);
});
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain(
        'tailor.workflow.execJobFunction("fetch-customer", { customerId: "123" }).then(',
      );
    });

    test("transforms only the outer call when a known start call is nested inside another", () => {
      const source = `
await myWorkflow.start(fetchCustomer.start({ customerId: "123" }));
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain(
        'await globalThis.tailor.workflow.startWorkflow("my-workflow", fetchCustomer.start({ customerId: "123" }));',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        'Nested start call "fetchCustomer.start(...)" inside "myWorkflow.start(...)" cannot be converted. Move it to a separate statement and pass the result instead.',
      );
    });

    test("replaces job.start() nested inside an unknown .start() argument", () => {
      const source = `
unknown.start(fetchCustomer.start({ customerId: "123" }));
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain(
        'tailor.workflow.execJobFunction("fetch-customer", { customerId: "123" })',
      );
      expect(result).toContain("unknown.start(");
    });
  });
});

describe("AST Transformer - hasStartCall", () => {
  test("detects a plain .start( call", () => {
    expect(hasStartCall("job.start({ id: 1 });")).toBe(true);
  });

  test("detects .start( split across whitespace/newlines", () => {
    expect(hasStartCall("job.start\n  (\n  { id: 1 }\n  );")).toBe(true);
  });

  test("detects .start( with a block comment before the parens", () => {
    expect(hasStartCall("job.start/* why */({ id: 1 });")).toBe(true);
  });

  test("detects .start( with a line comment before the parens", () => {
    expect(hasStartCall("job.start // why\n({ id: 1 });")).toBe(true);
  });

  test("returns false when there is no .start( call", () => {
    expect(hasStartCall("job.stop({ id: 1 });")).toBe(false);
  });
});

describe("AST Transformer - createStartTransformPlugin", () => {
  test("returns a plugin even when the start context has no workflow bindings", () => {
    expect(createStartTransformPlugin({ modules: new Map() }, createHookFailures())).toBeDefined();
  });

  test("returns undefined when no start context is provided", () => {
    expect(createStartTransformPlugin(undefined, createHookFailures())).toBeUndefined();
  });
});
