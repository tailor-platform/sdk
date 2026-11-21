import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { aroundAll, aroundEach, describe, expect, test } from "vitest";
import { runWithTsHook } from "#/cli/shared/test-helpers/ts-hook-child";
import { detectFunctionType } from "./detect";

const TEST_BASE = path.join(__dirname, "__test_detect__");

describe("detectFunctionType", () => {
  let testDir: string;

  aroundEach(async (runTest) => {
    testDir = path.join(TEST_BASE, `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(testDir, { recursive: true });
    await runTest();
  });

  aroundAll(async (runSuite) => {
    await runSuite();
    try {
      fs.rmSync(TEST_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const writeFile = (fileName: string, contents: string) => {
    const filePath = path.join(testDir, fileName);
    fs.writeFileSync(filePath, contents);
    return filePath;
  };

  describe("resolver detection", () => {
    test("detects a default-exported resolver", async () => {
      const filePath = writeFile(
        "resolver.mjs",
        `
export default {
  operation: "query",
  name: "my-resolver",
  body: (ctx) => ctx.input,
  output: { type: "string", metadata: {}, fields: {} },
};
`,
      );

      const result = await detectFunctionType({ filePath });
      expect(result.type).toBe("resolver");
      expect(result.name).toBe("my-resolver");
    });

    test("carries the resolver's `permission` config through for function run to enforce", async () => {
      const filePath = writeFile(
        "resolver-permission.mjs",
        `
export default {
  operation: "query",
  name: "protected",
  permission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
  body: (ctx) => ctx.input,
  output: { type: "string", metadata: {}, fields: {} },
};
`,
      );

      const result = await detectFunctionType({ filePath });
      expect(result.permission).toEqual([
        { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
      ]);
    });

    test("rejects a branded resolver with unknown helper keys", async () => {
      const filePath = path.join(testDir, "resolver-with-helper.mjs");
      fs.writeFileSync(
        filePath,
        `
const resolver = {
  operation: "query",
  name: "my-resolver",
  body: (ctx) => ctx.input,
  output: { type: "string", metadata: {}, fields: {} },
  trigger: () => {},
};

Object.defineProperty(resolver, Symbol.for("tailor-platform/sdk"), {
  value: "resolver",
});

export default resolver;
`,
      );

      await expect(detectFunctionType({ filePath })).rejects.toThrow(
        "Could not detect function type",
      );
    });

    test("builds a working local input parser from real t.* fields", async () => {
      const configureTypesUrl = pathToFileURL(
        path.join(__dirname, "../../../configure/types/index.ts"),
      ).href;
      const filePath = writeFile(
        "resolver.mjs",
        `
import { t } from "${configureTypesUrl}";
export default {
  operation: "query",
  name: "my-resolver",
  input: { name: t.string(), age: t.int({ optional: true }) },
  body: (ctx) => ctx.input,
  output: { type: "string", metadata: {}, fields: {} },
};
`,
      );

      const result = await detectFunctionType({ filePath });
      expect(result.hasInput).toBe(true);

      const valid = result.inputSchema?.parse({
        value: { name: "a", age: 1 },
        data: {},
        invoker: null,
      });
      expect(valid?.issues).toBeUndefined();

      const invalid = result.inputSchema?.parse({
        value: { age: "not-a-number" },
        data: {},
        invoker: null,
      });
      expect(invalid?.issues).toEqual([
        { message: "Required field is missing", path: ["name"] },
        { message: "Expected an integer: received not-a-number", path: ["age"] },
      ]);
    });
  });

  describe("executor detection", () => {
    test("detects a default-exported function executor", async () => {
      const filePath = writeFile(
        "executor.mjs",
        `
export default {
  name: "my-executor",
  trigger: { kind: "incomingWebhook" },
  operation: {
    kind: "function",
    body: (args) => {},
  },
};
`,
      );

      const result = await detectFunctionType({ filePath });
      expect(result.type).toBe("executor");
      expect(result.name).toBe("my-executor");
    });

    test("detects a function executor with trigger helper args", async () => {
      const filePath = path.join(testDir, "executor-with-helper.mjs");
      fs.writeFileSync(
        filePath,
        `
const executor = {
  name: "my-executor",
  trigger: { kind: "schedule", cron: "0 12 * * *", __args: [{ cron: "0 12 * * *" }] },
  operation: {
    kind: "function",
    body: (args) => {},
  },
};

Object.defineProperty(executor, Symbol.for("tailor-platform/sdk"), {
  value: "executor",
});

export default executor;
`,
      );

      const result = await detectFunctionType({ filePath });
      expect(result.type).toBe("executor");
      expect(result.name).toBe("my-executor");
    });

    test("does not detect a non-function executor", async () => {
      const filePath = writeFile(
        "gql-executor.mjs",
        `
export default {
  name: "gql-executor",
  trigger: { kind: "incomingWebhook" },
  operation: {
    kind: "graphql",
    query: "{ users { id } }",
  },
};
`,
      );

      // Should fall through to plain function check, which will also fail
      await expect(detectFunctionType({ filePath })).rejects.toThrow("Could not detect");
    });
  });

  describe("workflow job detection", () => {
    const multiJobSource = `
export const job_a = {
  name: "job-a",
  start: () => {},
  body: (input) => input,
};

export const job_b = {
  name: "job-b",
  start: () => {},
  body: (input) => input,
};
`;

    test("detects a single named-exported workflow job", async () => {
      const filePath = writeFile(
        "workflow.mjs",
        `
export const my_job = {
  name: "my-job",
  start: () => {},
  body: (input) => input,
};

export default {
  name: "my-workflow",
  mainJob: { name: "my-job", start: () => {}, body: () => {} },
};
`,
      );

      const result = await detectFunctionType({ filePath });
      expect(result.type).toBe("workflow-job");
      expect(result.name).toBe("my-job");
      expect(result.exportName).toBe("my_job");
    });

    describe("main job of the workflow a file exports", () => {
      const workflowSource = `${multiJobSource}
export default {
  name: "my-workflow",
  mainJob: { name: "job-b", start: () => {}, body: () => {} },
  start: () => {},
};
`;

      test("is selected without a job name when the caller asks for it", async () => {
        const filePath = writeFile("workflow-main.mjs", workflowSource);

        const result = await detectFunctionType({ filePath, useWorkflowMainJob: true });

        expect(result.name).toBe("job-b");
        expect(result.exportName).toBe("job_b");
      });

      test("is not picked unless the caller asks for it, so function run still asks for --name", async () => {
        const filePath = writeFile("workflow-main-default.mjs", workflowSource);

        await expect(detectFunctionType({ filePath })).rejects.toThrow(
          "Multiple workflow jobs found",
        );
      });

      const importedMain = `export default {
  name: "my-workflow",
  mainJob: { name: "job-b", start: () => {}, body: () => {} },
  start: () => {},
};
`;

      test("is refused with a code of its own when the file only imports it", async () => {
        const filePath = writeFile("workflow-main-imported.mjs", importedMain);

        await expect(detectFunctionType({ filePath, useWorkflowMainJob: true })).rejects.toThrow(
          expect.objectContaining({ code: "WORKFLOW_RUN_MAIN_JOB_IMPORTED" }),
        );
      });

      test("is refused the same way when the file exports another job but not the main one", async () => {
        const filePath = writeFile(
          "workflow-main-imported-other.mjs",
          `export const job_a = { name: "job-a", start: () => {}, body: () => {} };\n${importedMain}`,
        );

        await expect(detectFunctionType({ filePath, useWorkflowMainJob: true })).rejects.toThrow(
          expect.objectContaining({ code: "WORKFLOW_RUN_MAIN_JOB_IMPORTED" }),
        );
      });

      test("yields to a job name that was given", async () => {
        const filePath = writeFile("workflow-main-named.mjs", workflowSource);

        const result = await detectFunctionType({
          filePath,
          jobName: "job-a",
          useWorkflowMainJob: true,
        });

        expect(result.name).toBe("job-a");
      });
    });

    test("selects a workflow job by --name", async () => {
      const filePath = writeFile("multi-jobs.mjs", multiJobSource);

      const result = await detectFunctionType({ filePath, jobName: "job-b" });
      expect(result.type).toBe("workflow-job");
      expect(result.name).toBe("job-b");
      expect(result.exportName).toBe("job_b");
    });

    test("throws when multiple jobs exist without --name", async () => {
      const filePath = writeFile("multi-jobs.mjs", multiJobSource);

      await expect(detectFunctionType({ filePath })).rejects.toThrow(
        "Multiple workflow jobs found",
      );
    });

    test("tells to specify the job with --name by default", async () => {
      const filePath = writeFile("multi-jobs.mjs", multiJobSource);

      await expect(detectFunctionType({ filePath })).rejects.toMatchObject({
        suggestion: "Specify one with --name.",
      });
    });

    test("names the flag of the command asking when it is not --name", async () => {
      const filePath = writeFile("multi-jobs.mjs", multiJobSource);

      await expect(detectFunctionType({ filePath, jobFlag: "--job" })).rejects.toMatchObject({
        suggestion: "Specify one with --job.",
      });
    });

    test("throws when --name does not match any job", async () => {
      const filePath = writeFile(
        "workflow.mjs",
        `
export const my_job = {
  name: "my-job",
  start: () => {},
  body: (input) => input,
};
`,
      );

      await expect(detectFunctionType({ filePath, jobName: "nonexistent" })).rejects.toThrow(
        'Workflow job "nonexistent" not found',
      );
    });
  });

  describe("plain function detection", () => {
    test("detects a default-exported plain function", async () => {
      const filePath = writeFile(
        "my-function.mjs",
        `
export default function(input) {
  return { result: input };
}
`,
      );

      const result = await detectFunctionType({ filePath });
      expect(result.type).toBe("plain");
      expect(result.name).toBe("my-function");
      expect(result.namedMain).toBeUndefined();
    });

    test("detects a named-exported main function", async () => {
      const filePath = writeFile(
        "my-main.mjs",
        `
export function main(input) {
  return { result: input };
}
`,
      );

      const result = await detectFunctionType({ filePath });
      expect(result.type).toBe("plain");
      expect(result.name).toBe("my-main");
      expect(result.namedMain).toBe(true);
    });

    test("prefers default export over named main", async () => {
      const filePath = writeFile(
        "both.mjs",
        `
export function main(input) {
  return { named: true };
}
export default function(input) {
  return { default: true };
}
`,
      );

      const result = await detectFunctionType({ filePath });
      expect(result.type).toBe("plain");
      expect(result.namedMain).toBeUndefined();
    });
  });

  describe("error cases", () => {
    test("throws when file exports nothing recognizable", async () => {
      const filePath = writeFile("empty.mjs", `export default 42;`);

      await expect(detectFunctionType({ filePath })).rejects.toThrow("Could not detect");
    });

    test("reports a file that does not parse as SYNTAX_INVALID", { timeout: 60_000 }, () => {
      const filePath = writeFile("broken.ts", "export const broken = ;\n");

      const outcome = runWithTsHook(
        `
        const { detectFunctionType } = await import("#/cli/commands/function/detect");
        try {
          await detectFunctionType({ filePath: ${JSON.stringify(filePath)} });
          console.log(JSON.stringify({}));
        } catch (error) {
          console.log(JSON.stringify({ code: error.code, message: error.message }));
        }
        `,
        testDir,
      );

      expect(outcome).toEqual({
        code: "SYNTAX_INVALID",
        message: "Invalid syntax: Expression expected",
      });
    });
  });
});
