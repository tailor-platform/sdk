import * as fs from "node:fs";
import * as path from "pathe";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { detectFunctionType } from "./detect";

const TEST_BASE = path.join(__dirname, "__test_detect__");

describe("detectFunctionType", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(TEST_BASE, `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
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
  trigger: () => {},
  body: (input) => input,
};

export const job_b = {
  name: "job-b",
  trigger: () => {},
  body: (input) => input,
};
`;

    test("detects a single named-exported workflow job", async () => {
      const filePath = writeFile(
        "workflow.mjs",
        `
export const my_job = {
  name: "my-job",
  trigger: () => {},
  body: (input) => input,
};

export default {
  name: "my-workflow",
  mainJob: { name: "my-job", trigger: () => {}, body: () => {} },
};
`,
      );

      const result = await detectFunctionType({ filePath });
      expect(result.type).toBe("workflow-job");
      expect(result.name).toBe("my-job");
      expect(result.exportName).toBe("my_job");
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

    test("throws when --name does not match any job", async () => {
      const filePath = writeFile(
        "workflow.mjs",
        `
export const my_job = {
  name: "my-job",
  trigger: () => {},
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
  });
});
