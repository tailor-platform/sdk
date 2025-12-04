import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";
import {
  findAllJobs,
  transformWorkflowSource,
  detectTriggerCalls,
  buildJobNameMap,
  findAllWorkflows,
  buildWorkflowNameMap,
  transformFunctionTriggers,
} from "./ast-transformer";

// Note: parseSync is imported here for unit tests of findAllJobs
// transformWorkflowSource uses it internally

describe("AST Transformer - createWorkflowJob call detection", () => {
  describe("findAllJobs", () => {
    it("detects createWorkflowJob calls", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const job1 = createWorkflowJob({
  name: "job-one",
  body: async () => { return "one"; }
});

const job2 = createWorkflowJob({
  name: "job-two",
  body: async (input, { env }) => {
    return await job1.trigger();
  }
});
`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(2);
      expect(jobs[0].name).toBe("job-one");
      expect(jobs[0].exportName).toBe("job1");
      expect(jobs[1].name).toBe("job-two");
      expect(jobs[1].exportName).toBe("job2");
    });

    it("does not detect objects where body is not a function", () => {
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
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe("real-job");
    });

    it("does not detect objects where name is not a string literal", () => {
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
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe("real-job");
    });

    it("bodyValueRange returns correct position", () => {
      const source = `import { createWorkflowJob } from "@tailor-platform/sdk";
const job = createWorkflowJob({ name: "test", body: () => { return 42; } });`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(1);
      const bodyCode = source.slice(
        jobs[0].bodyValueRange.start,
        jobs[0].bodyValueRange.end,
      );
      expect(bodyCode).toBe("() => { return 42; }");
    });

    it("exportName is extracted from variable declaration", () => {
      const source = `import { createWorkflowJob } from "@tailor-platform/sdk";
export const myJob = createWorkflowJob({ name: "my-job-name", body: () => {} });`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe("my-job-name");
      expect(jobs[0].exportName).toBe("myJob");
    });

    describe("verify no false positives occur", () => {
      it("function calls other than createWorkflowJob are not detected", () => {
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
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        // only createWorkflowJob calls are detected
        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("real-job");
      });

      it("objects not passed to createWorkflowJob are not detected", () => {
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
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        // only createWorkflowJob calls are detected
        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("real-job");
      });

      it("objects in arrays are not detected unless used with createWorkflowJob", () => {
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
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        // not detected because no createWorkflowJob call exists
        expect(jobs).toHaveLength(0);
      });
    });

    describe("various import patterns", () => {
      it("aliased import", () => {
        const source = `
import { createWorkflowJob as create } from "@tailor-platform/sdk";

const job = create({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });

      it("default import", () => {
        const source = `
import sdk from "@tailor-platform/sdk";

const job = sdk.createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });

      it("namespace import", () => {
        const source = `
import * as sdk from "@tailor-platform/sdk";

const job = sdk.createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });

      it("subpath import", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk/configure";

const job = createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });

      it("dynamic import", () => {
        const source = `
const sdk = await import("@tailor-platform/sdk");

const job = sdk.createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });

      it("require()", () => {
        const source = `
const { createWorkflowJob } = require("@tailor-platform/sdk");

const job = createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });
    });

    describe("false negatives (patterns that cannot be detected)", () => {
      it("cannot detect when body is a reference to a function", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

async function myHandler() { return "result"; }

const job = createWorkflowJob({
  name: "my-job",
  body: myHandler
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(0);
      });

      it("cannot detect when name is a variable", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const jobName = "my-job";

const job = createWorkflowJob({
  name: jobName,
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(0);
      });

      it("cannot detect objects composed only of spread operators", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const nameConfig = { name: "my-job" };
const bodyConfig = { body: async () => {} };

const job = createWorkflowJob({ ...nameConfig, ...bodyConfig });
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(0);
      });

      it("cannot detect config objects passed as variables", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const config = { name: "my-job", body: async () => {} };

const job = createWorkflowJob(config);
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        // cannot detect because config is a variable
        expect(jobs).toHaveLength(0);
      });

      it("cannot detect after reassignment to a variable", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const create = createWorkflowJob;
const job = create({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(0);
      });

      it("cannot detect after destructuring from namespace", () => {
        const source = `
import * as sdk from "@tailor-platform/sdk";

const { createWorkflowJob } = sdk;
const job = createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(0);
      });
    });
  });
});

describe("AST Transformer - trigger call detection", () => {
  describe("detectTriggerCalls", () => {
    it("detects simple trigger calls", () => {
      const source = `
const result = await otherJob.trigger({ id: 123 });
`;
      const { program } = parseSync("test.ts", source);
      const calls = detectTriggerCalls(program, source);

      expect(calls).toHaveLength(1);
      expect(calls[0].identifierName).toBe("otherJob");
      expect(calls[0].argsText).toBe("{ id: 123 }");
    });

    it("detects multiple trigger calls", () => {
      const source = `
const a = await job1.trigger({ x: 1 });
const b = await job2.trigger({ y: 2 });
`;
      const { program } = parseSync("test.ts", source);
      const calls = detectTriggerCalls(program, source);

      expect(calls).toHaveLength(2);
      expect(calls[0].identifierName).toBe("job1");
      expect(calls[1].identifierName).toBe("job2");
    });

    it("detects trigger calls without arguments", () => {
      const source = `
const result = await simpleJob.trigger();
`;
      const { program } = parseSync("test.ts", source);
      const calls = detectTriggerCalls(program, source);

      expect(calls).toHaveLength(1);
      expect(calls[0].identifierName).toBe("simpleJob");
      expect(calls[0].argsText).toBe("");
    });
  });

  describe("buildJobNameMap", () => {
    it("builds map from export name to job name", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

export const fetchCustomer = createWorkflowJob({
  name: "fetch-customer",
  body: async () => {}
});

export const sendNotification = createWorkflowJob({
  name: "send-notification",
  body: async () => {}
});
`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);
      const map = buildJobNameMap(jobs);

      expect(map.get("fetchCustomer")).toBe("fetch-customer");
      expect(map.get("sendNotification")).toBe("send-notification");
    });
  });
});

describe("AST Transformer - transformation logic", () => {
  describe("transformWorkflowSource", () => {
    it("transforms trigger calls to triggerJobFunction", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const fetchData = createWorkflowJob({
  name: "fetch-data",
  body: async () => ({ data: "test" })
});

const mainJob = createWorkflowJob({
  name: "main-job",
  body: async (input, { env }) => {
    const result = await fetchData.trigger({ id: input.id });
    return result;
  }
});
`;
      const allJobsMap = new Map<string, string>([
        ["fetchData", "fetch-data"],
        ["mainJob", "main-job"],
      ]);
      const result = transformWorkflowSource(
        source,
        "main-job",
        "mainJob",
        ["fetchData"],
        allJobsMap,
      );

      // trigger call is transformed
      expect(result).toContain(
        'tailor.workflow.triggerJobFunction("fetch-data", { id: input.id })',
      );
      // fetchData declaration is removed (const fetchData = ...)
      expect(result).not.toContain("const fetchData");
    });

    it("completely removes other job declarations", () => {
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
    const result = await heavyJob.trigger();
    return { result: "main" };
  }
});
`;
      const allJobsMap = new Map<string, string>([
        ["heavyJob", "heavy-job"],
        ["mainJob", "main-job"],
      ]);
      const result = transformWorkflowSource(
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
      // trigger is transformed (job name appears in triggerJobFunction call)
      expect(result).toContain(
        'tailor.workflow.triggerJobFunction("heavy-job", undefined)',
      );
    });

    it("removes declarations of multiple other jobs", () => {
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
    await job1.trigger();
    await job2.trigger();
    return "main";
  }
});
`;
      const allJobsMap = new Map<string, string>([
        ["job1", "job-one"],
        ["job2", "job-two"],
        ["mainJob", "main-job"],
      ]);
      const result = transformWorkflowSource(
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
      // triggers are transformed (job names appear in triggerJobFunction calls)
      expect(result).toContain(
        'tailor.workflow.triggerJobFunction("job-one", undefined)',
      );
      expect(result).toContain(
        'tailor.workflow.triggerJobFunction("job-two", undefined)',
      );
    });

    it("does not modify jobs without trigger calls", () => {
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
  });
});

describe("AST Transformer - workflow detection", () => {
  describe("findAllWorkflows", () => {
    it("detects createWorkflow calls", () => {
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
      const { program } = parseSync("test.ts", source);
      const workflows = findAllWorkflows(program, source);

      expect(workflows).toHaveLength(1);
      expect(workflows[0].name).toBe("my-workflow");
      expect(workflows[0].exportName).toBe("myWorkflow");
    });

    it("detects default exported workflow", () => {
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
      const { program } = parseSync("test.ts", source);
      const workflows = findAllWorkflows(program, source);

      expect(workflows).toHaveLength(1);
      expect(workflows[0].name).toBe("default-workflow");
      expect(workflows[0].isDefaultExport).toBe(true);
    });

    it("detects multiple workflows", () => {
      const source = `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const job1 = createWorkflowJob({ name: "job1", body: async () => ({}) });
const job2 = createWorkflowJob({ name: "job2", body: async () => ({}) });

const workflow1 = createWorkflow({ name: "workflow-one", mainJob: job1 });
const workflow2 = createWorkflow({ name: "workflow-two", mainJob: job2 });
`;
      const { program } = parseSync("test.ts", source);
      const workflows = findAllWorkflows(program, source);

      expect(workflows).toHaveLength(2);
      expect(workflows[0].name).toBe("workflow-one");
      expect(workflows[1].name).toBe("workflow-two");
    });
  });

  describe("buildWorkflowNameMap", () => {
    it("builds map from export name to workflow name", () => {
      const source = `
import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const job = createWorkflowJob({ name: "job", body: async () => ({}) });

export const orderProcessing = createWorkflow({
  name: "order-processing",
  mainJob: job
});
`;
      const { program } = parseSync("test.ts", source);
      const workflows = findAllWorkflows(program, source);
      const map = buildWorkflowNameMap(workflows);

      expect(map.get("orderProcessing")).toBe("order-processing");
    });
  });
});

describe("AST Transformer - transformFunctionTriggers", () => {
  describe("workflow trigger transformation", () => {
    it("transforms workflow.trigger() calls to tailor.workflow.triggerWorkflow()", () => {
      const source = `
const workflowRunId = await orderWorkflow.trigger(
  { orderId: "123", customerId: "456" },
  { authInvoker: auth.invoker("admin") }
);
`;
      const workflowNameMap = new Map([["orderWorkflow", "order-processing"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformFunctionTriggers(
        source,
        workflowNameMap,
        jobNameMap,
      );

      expect(result).toContain(
        'tailor.workflow.triggerWorkflow("order-processing"',
      );
      expect(result).toContain('{ orderId: "123", customerId: "456" }');
      expect(result).toContain('{ authInvoker: auth.invoker("admin") }');
    });

    it("transforms workflow.trigger() with shorthand authInvoker", () => {
      const source = `
const authInvoker = auth.invoker("admin");
const result = await myWorkflow.trigger({ id: 1 }, { authInvoker });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformFunctionTriggers(
        source,
        workflowNameMap,
        jobNameMap,
      );

      expect(result).toContain('tailor.workflow.triggerWorkflow("my-workflow"');
      expect(result).toContain("{ authInvoker: authInvoker }");
    });
  });

  describe("job trigger transformation", () => {
    it("transforms job.trigger() calls to tailor.workflow.triggerJobFunction()", () => {
      const source = `
const result = await fetchCustomer.trigger({ customerId: "123" });
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformFunctionTriggers(
        source,
        workflowNameMap,
        jobNameMap,
      );

      expect(result).toContain(
        'tailor.workflow.triggerJobFunction("fetch-customer"',
      );
      expect(result).toContain('{ customerId: "123" }');
    });

    it("transforms job.trigger() without arguments", () => {
      const source = `
const result = await simpleJob.trigger();
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map([["simpleJob", "simple-job"]]);

      const result = transformFunctionTriggers(
        source,
        workflowNameMap,
        jobNameMap,
      );

      expect(result).toContain(
        'tailor.workflow.triggerJobFunction("simple-job", undefined)',
      );
    });
  });

  describe("false positive prevention", () => {
    it("does not transform .trigger() calls on unknown identifiers", () => {
      const source = `
// This should NOT be transformed
const result = await someRandomObject.trigger({ data: "test" });

// Neither should this
const event = button.trigger("click");
`;
      const workflowNameMap = new Map<string, string>();
      const jobNameMap = new Map<string, string>();

      const result = transformFunctionTriggers(
        source,
        workflowNameMap,
        jobNameMap,
      );

      // Should remain unchanged
      expect(result).toContain('someRandomObject.trigger({ data: "test" })');
      expect(result).toContain('button.trigger("click")');
      expect(result).not.toContain("tailor.workflow");
    });

    it("only transforms trigger calls for known workflows and jobs", () => {
      const source = `
// Known workflow - should be transformed
const wfResult = await orderWorkflow.trigger({ id: 1 }, { authInvoker: auth.invoker("admin") });

// Known job - should be transformed
const jobResult = await fetchData.trigger({ id: 2 });

// Unknown - should NOT be transformed
const unknown = await randomThing.trigger({ id: 3 });
`;
      const workflowNameMap = new Map([["orderWorkflow", "order-processing"]]);
      const jobNameMap = new Map([["fetchData", "fetch-data"]]);

      const result = transformFunctionTriggers(
        source,
        workflowNameMap,
        jobNameMap,
      );

      // Known workflow transformed
      expect(result).toContain(
        'tailor.workflow.triggerWorkflow("order-processing"',
      );
      // Known job transformed
      expect(result).toContain(
        'tailor.workflow.triggerJobFunction("fetch-data"',
      );
      // Unknown NOT transformed
      expect(result).toContain("randomThing.trigger({ id: 3 })");
    });

    it("does not transform workflow identifier used as job trigger (wrong argument count)", () => {
      const source = `
// Workflow trigger requires 2 args - this has only 1, so it won't be transformed as workflow
const result = await myWorkflow.trigger({ id: 1 });
`;
      const workflowNameMap = new Map([["myWorkflow", "my-workflow"]]);
      const jobNameMap = new Map<string, string>();

      const result = transformFunctionTriggers(
        source,
        workflowNameMap,
        jobNameMap,
      );

      // Not transformed because workflow needs 2 args
      expect(result).toContain("myWorkflow.trigger({ id: 1 })");
      expect(result).not.toContain("tailor.workflow");
    });
  });

  describe("mixed workflow and job triggers", () => {
    it("transforms both workflow and job triggers in the same source", () => {
      const source = `
async function processOrder(orderId: string) {
  // Trigger a job to fetch data
  const data = await fetchCustomer.trigger({ id: orderId });

  // Then trigger a workflow for processing
  const workflowRunId = await orderWorkflow.trigger(
    { orderId, data },
    { authInvoker: auth.invoker("system") }
  );

  return { data, workflowRunId };
}
`;
      const workflowNameMap = new Map([["orderWorkflow", "order-processing"]]);
      const jobNameMap = new Map([["fetchCustomer", "fetch-customer"]]);

      const result = transformFunctionTriggers(
        source,
        workflowNameMap,
        jobNameMap,
      );

      expect(result).toContain(
        'tailor.workflow.triggerJobFunction("fetch-customer"',
      );
      expect(result).toContain(
        'tailor.workflow.triggerWorkflow("order-processing"',
      );
    });
  });
});
