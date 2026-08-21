import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import {
  normalizeFilePath,
  type StartContext,
  type StartModuleBindings,
  type StartTarget,
} from "#/cli/shared/start-context";
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

  const context: StartContext = { modules, authNamespace };
  return transformStartCallsWithContext(source, context, currentFilePath);
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
  );
  return transformStartCalls(stripped, new Map(), jobNameMap);
}

describe("AST Transformer - createWorkflowJob call detection", () => {
  describe("findAllJobs", () => {
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
      const result = transformWorkflowSource(source, "main-job");

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
      const result = transformWorkflowSource(source, "simple-job");

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

      const result = transformWorkflowSource(source, "main-job", "mainJob", ["step"]);

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
      const result = transformWorkflowSource(source, "check-inventory");

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
      const result = transformWorkflowSource(source, "main-job");

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
      const result = transformWorkflowSource(source, "caller-job");

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
    test("transforms workflow.start() calls to tailor.workflow.startWorkflow()", () => {
      const source = `
const workflowRunId = await orderWorkflow.start(
  { orderId: "123", customerId: "456" },
  { invoker: "admin" }
);
`;
      const workflowNameMap = new Map([["orderWorkflow", "order-processing"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain('tailor.workflow.startWorkflow("order-processing"');
      expect(result).toContain('{ orderId: "123", customerId: "456" }');
      expect(result).toContain('{ invoker: "admin" }');
    });

    test("transforms workflow.start() with shorthand invoker", () => {
      const source = `
const invoker = "admin";
const result = await myWorkflow.start({ id: 1 }, { invoker });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain('tailor.workflow.startWorkflow("my-workflow"');
      expect(result).toContain("{ invoker }");
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

    test("keeps options unchanged and omits the helper when authNamespace is not provided", () => {
      const source = `
const result = await myWorkflow.start({ id: 1 }, { invoker: "kiosk" });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain(
        'tailor.workflow.startWorkflow("my-workflow", { id: 1 }, { invoker: "kiosk" })',
      );
      expect(result).not.toContain("__tailor_normalizeStartOptions");
    });
  });
  describe("job start transformation", () => {
    test("transforms job.start() calls to tailor.workflow.execJobFunction()", () => {
      const source = `
const result = await fetchCustomer.start({ customerId: "123" });
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain('tailor.workflow.execJobFunction("fetch-customer"');
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

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

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

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

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
        'const customer = await tailor.workflow.execJobFunction("fetch-customer", { customerId: "123" })',
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

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain('await tailor.workflow.startWorkflow("order-processing"');
      expect(result).not.toContain("(async () => tailor.workflow.startWorkflow");
    });

    test("replaces job.start() without await with the raw platform result", () => {
      const source = `
const customerPromise = fetchCustomer.start({ customerId: "123" });
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformStartCalls(source, workflowNameMap, jobNameMap);

      expect(result).toContain(
        'const customerPromise = tailor.workflow.execJobFunction("fetch-customer", { customerId: "123" })',
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
        'await tailor.workflow.startWorkflow("my-workflow", fetchCustomer.start({ customerId: "123" }));',
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
  test("returns undefined when the start context has no workflow bindings", () => {
    expect(createStartTransformPlugin({ modules: new Map() })).toBeUndefined();
  });

  test("returns undefined when no start context is provided", () => {
    expect(createStartTransformPlugin(undefined)).toBeUndefined();
  });

  test("returns a plugin when the start context has workflow bindings", () => {
    const modules = new Map([
      [
        normalizeFilePath(path.resolve("test.ts")),
        {
          sourceFile: path.resolve("test.ts"),
          localBindings: new Map(),
          exports: new Map(),
        } satisfies StartModuleBindings,
      ],
    ]);

    expect(createStartTransformPlugin({ modules })).toBeDefined();
  });
});
