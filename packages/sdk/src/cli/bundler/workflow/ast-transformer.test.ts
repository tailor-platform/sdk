import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";
import {
  findAllJobs,
  transformWorkflowSource,
  detectTriggerCalls,
  buildJobNameMap,
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
