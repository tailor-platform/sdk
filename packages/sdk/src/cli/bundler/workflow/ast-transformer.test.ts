import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";
import { findAllJobs, transformWorkflowSource } from "./ast-transformer";

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
  deps: [job1],
  body: async (input, jobs) => {
    return await jobs.jobOne();
  }
});
`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(2);
      expect(jobs[0].name).toBe("job-one");
      expect(jobs[0].depsRange).toBeUndefined();
      expect(jobs[1].name).toBe("job-two");
      expect(jobs[1].depsRange).toBeDefined();
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

    it("depsRange returns correct position", () => {
      const source = `import { createWorkflowJob } from "@tailor-platform/sdk";
const job = createWorkflowJob({ name: "test", deps: [a, b], body: () => {} });`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].depsRange).toBeDefined();
      const depsCode = source.slice(
        jobs[0].depsRange!.start,
        jobs[0].depsRange!.end,
      );
      expect(depsCode).toBe("deps: [a, b]");
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

describe("AST Transformer - transformation logic", () => {
  describe("transformWorkflowSource", () => {
    it("removes deps from target job", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const job1 = createWorkflowJob({
  name: "job-one",
  body: () => "one"
});

const job2 = createWorkflowJob({
  name: "job-two",
  deps: [job1],
  body: async (input, jobs) => {
    return await jobs.jobOne();
  }
});
`;
      const result = transformWorkflowSource(source, "job-two");

      // deps removed from job-two
      expect(result).not.toMatch(/name: "job-two"[\s\S]*deps:/);
      // body of job-two is preserved
      expect(result).toContain("await jobs.jobOne()");
      // job1 declaration is removed
      expect(result).not.toContain("job-one");
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
  deps: [heavyJob],
  body: async (input, jobs) => {
    return { result: "main" };
  }
});
`;
      const result = transformWorkflowSource(source, "main-job");

      // heavyJob declaration is completely removed
      expect(result).not.toContain("heavy-job");
      expect(result).not.toContain("heavyJob");
      // getDB is removed
      expect(result).not.toContain("getDB");
      // mainJob body is preserved
      expect(result).toContain('result: "main"');
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
  deps: [job1, job2],
  body: () => "main"
});
`;
      const result = transformWorkflowSource(source, "main-job");

      // job1, job2 declarations are removed
      expect(result).not.toContain("job-one");
      expect(result).not.toContain("job-two");
      // mainJob body is preserved
      expect(result).toContain('"main"');
      // heavy code is removed
      expect(result).not.toContain("heavy code");
    });

    it("does not modify jobs without deps", () => {
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
