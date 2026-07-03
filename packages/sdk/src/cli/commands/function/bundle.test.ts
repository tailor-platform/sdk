import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { bundleForTestRun, type ResolvedMachineUser } from "./bundle";
import type { DetectedFunction } from "./detect";

const TEST_BASE = path.join(__dirname, "__test_bundler__");

const defaultMachineUser: ResolvedMachineUser = {
  name: "test-machine-user",
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  attributes: { role: "ADMIN" },
  attributeList: [],
};

const defaultWorkspaceId = "11111111-2222-3333-4444-555555555555";

describe("bundleForTestRun", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(TEST_BASE, `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TAILOR_BUILD_OUTPUT_DIR = testDir;
  });

  afterAll(() => {
    delete process.env.TAILOR_BUILD_OUTPUT_DIR;
    try {
      fs.rmSync(TEST_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function bundle(
    fileName: string,
    source: string,
    detected: DetectedFunction,
    options?: Partial<Omit<Parameters<typeof bundleForTestRun>[0], "detected" | "sourceFile">>,
  ) {
    const sourceFile = path.join(testDir, fileName);
    fs.writeFileSync(sourceFile, source);
    return bundleForTestRun({
      detected,
      sourceFile,
      machineUser: defaultMachineUser,
      workspaceId: defaultWorkspaceId,
      ...options,
    });
  }

  async function expectMainExport(fileName: string, bundledCode: string) {
    const tempFile = path.join(testDir, fileName);
    fs.writeFileSync(tempFile, bundledCode);
    const mod = await import(pathToFileURL(tempFile).href);
    expect(typeof mod.main).toBe("function");
  }

  describe("plain function", () => {
    test("bundles a default-exported function as main", async () => {
      const detected: DetectedFunction = { type: "plain", name: "fn" };
      const result = await bundle(
        "fn.ts",
        `
export default function(input: any) {
  return { hello: input.name };
}
`,
        detected,
      );

      expect(result.scriptName).toBe("test-run--fn.js");
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("export");
      await expectMainExport("verify-plain.mjs", result.bundledCode);
    });

    test("bundles a named-exported main function", async () => {
      const detected: DetectedFunction = { type: "plain", name: "named-main", namedMain: true };
      const result = await bundle(
        "named-main.ts",
        `
export function main(input: any) {
  return { hello: input.name };
}
`,
        detected,
      );

      expect(result.scriptName).toBe("test-run--named-main.js");
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("export");
      await expectMainExport("verify-named-main.mjs", result.bundledCode);
    });

    test("drops console calls below the configured logLevel", async () => {
      const detected: DetectedFunction = { type: "plain", name: "logs", namedMain: true };
      const result = await bundle(
        "logs.ts",
        `
export function main() {
  console.debug("debug");
  console.log("log");
  console.info("info");
  console.warn("warn");
  console.error("error");
  return true;
}
`,
        detected,
        { inlineSourcemap: false, logLevel: "WARN" },
      );

      expect(result.bundledCode).not.toContain("console.debug");
      expect(result.bundledCode).not.toContain("console.log");
      expect(result.bundledCode).not.toContain("console.info");
      expect(result.bundledCode).toContain("console.warn");
      expect(result.bundledCode).toContain("console.error");
    });
  });

  describe("resolver", () => {
    test("bundles a resolver with validation wrapper", async () => {
      const detected: DetectedFunction = { type: "resolver", name: "add" };
      const result = await bundle(
        "resolver.ts",
        `
export default {
  operation: "query",
  name: "add",
  body: (ctx: any) => ctx.input.a + ctx.input.b,
  output: { type: "integer", metadata: {} },
};
`,
        detected,
      );

      expect(result.scriptName).toBe("test-run--add.js");
      // Check bundled code structure (can't import because it references @tailor-platform/sdk)
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("export");
      // Validation wrapper should be present
      expect(result.bundledCode).toContain("input");
    });

    test("embeds machine user as user context", async () => {
      const detected: DetectedFunction = { type: "resolver", name: "userInfo" };
      const result = await bundle(
        "resolver-user.ts",
        `
export default {
  operation: "query",
  name: "userInfo",
  body: (ctx: any) => ctx.user,
  output: { type: "string", metadata: {} },
};
`,
        detected,
      );

      expect(result.bundledCode).toContain("machine_user");
      expect(result.bundledCode).toContain("ADMIN");
      expect(result.bundledCode).toContain(defaultMachineUser.id);
      expect(result.bundledCode).toContain(defaultWorkspaceId);
    });

    test("embeds machine user with null attributes (external auth)", async () => {
      const detected: DetectedFunction = { type: "resolver", name: "ext" };
      const machineUser: ResolvedMachineUser = {
        name: "external-user",
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        attributes: null,
        attributeList: [],
      };
      const result = await bundle(
        "resolver-ext.ts",
        `
export default {
  operation: "query",
  name: "ext",
  body: (ctx: any) => ctx.user,
  output: { type: "string", metadata: {} },
};
`,
        detected,
        { machineUser },
      );

      expect(result.bundledCode).toContain("machine_user");
      expect(result.bundledCode).toContain(defaultWorkspaceId);
    });
  });

  describe("executor", () => {
    test("bundles an executor extracting operation.body", async () => {
      const detected: DetectedFunction = { type: "executor", name: "test-executor" };
      const result = await bundle(
        "executor.ts",
        `
export default {
  name: "test-executor",
  trigger: { kind: "incomingWebhook" },
  operation: {
    kind: "function",
    body: (args: any) => { return { received: true }; },
  },
};
`,
        detected,
      );

      expect(result.scriptName).toBe("test-run--test-executor.js");
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("export");
      await expectMainExport("verify-executor.mjs", result.bundledCode);
    });

    test("embeds machine user as actor context", async () => {
      const detected: DetectedFunction = { type: "executor", name: "test-actor" };
      const result = await bundle(
        "executor-actor.ts",
        `
export default {
  name: "test-actor",
  trigger: { kind: "incomingWebhook" },
  operation: {
    kind: "function",
    body: (args: any) => args.actor,
  },
};
`,
        detected,
      );

      expect(result.bundledCode).toContain("machine_user");
      expect(result.bundledCode).toContain("ADMIN");
      expect(result.bundledCode).toContain(defaultMachineUser.id);
      expect(result.bundledCode).toContain(defaultWorkspaceId);
    });
  });

  describe("workflow job", () => {
    test("bundles a workflow job with env injection", async () => {
      const detected: DetectedFunction = {
        type: "workflow-job",
        name: "my-job",
        exportName: "my_job",
      };
      const result = await bundle(
        "workflow.ts",
        `
export const my_job = {
  name: "my-job",
  trigger: () => {},
  body: (input: any, ctx: any) => ({ result: input, env: ctx.env }),
};

export default {
  name: "test-workflow",
  mainJob: my_job,
};
`,
        detected,
        { env: { APP_URL: "https://example.com", DEBUG: true } },
      );

      expect(result.scriptName).toBe("test-run--my-job.js");
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("https://example.com");
      await expectMainExport("verify-workflow.mjs", result.bundledCode);
    });
  });
});
