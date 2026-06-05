import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bundleForTestRun, type ResolvedMachineUser } from "./bundle";
import type { DetectedFunction } from "./detect";

const TEST_BASE = path.join(__dirname, "__test_bundle__");

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
    process.env.TAILOR_SDK_OUTPUT_DIR = testDir;
  });

  afterAll(() => {
    delete process.env.TAILOR_SDK_OUTPUT_DIR;
    try {
      fs.rmSync(TEST_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("plain function", () => {
    it("bundles a default-exported function as main", async () => {
      const sourceFile = path.join(testDir, "fn.ts");
      fs.writeFileSync(
        sourceFile,
        `
export default function(input: any) {
  return { hello: input.name };
}
`,
      );

      const detected: DetectedFunction = { type: "plain", name: "fn" };
      const result = await bundleForTestRun({
        detected,
        sourceFile,
        machineUser: defaultMachineUser,
        workspaceId: defaultWorkspaceId,
      });

      expect(result.scriptName).toBe("test-run--fn.js");
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("export");

      // Verify bundled code can be imported and main is a function
      const tempFile = path.join(testDir, "verify-plain.mjs");
      fs.writeFileSync(tempFile, result.bundledCode);
      const mod = await import(pathToFileURL(tempFile).href);
      expect(typeof mod.main).toBe("function");
    });

    it("bundles a named-exported main function", async () => {
      const sourceFile = path.join(testDir, "named-main.ts");
      fs.writeFileSync(
        sourceFile,
        `
export function main(input: any) {
  return { hello: input.name };
}
`,
      );

      const detected: DetectedFunction = { type: "plain", name: "named-main", namedMain: true };
      const result = await bundleForTestRun({
        detected,
        sourceFile,
        machineUser: defaultMachineUser,
        workspaceId: defaultWorkspaceId,
      });

      expect(result.scriptName).toBe("test-run--named-main.js");
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("export");

      const tempFile = path.join(testDir, "verify-named-main.mjs");
      fs.writeFileSync(tempFile, result.bundledCode);
      const mod = await import(pathToFileURL(tempFile).href);
      expect(typeof mod.main).toBe("function");
    });

    it("drops console calls below the configured logLevel", async () => {
      const sourceFile = path.join(testDir, "logs.ts");
      fs.writeFileSync(
        sourceFile,
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
      );

      const detected: DetectedFunction = { type: "plain", name: "logs", namedMain: true };
      const result = await bundleForTestRun({
        detected,
        sourceFile,
        inlineSourcemap: false,
        logLevel: "WARN",
        machineUser: defaultMachineUser,
        workspaceId: defaultWorkspaceId,
      });

      expect(result.bundledCode).not.toContain("console.debug");
      expect(result.bundledCode).not.toContain("console.log");
      expect(result.bundledCode).not.toContain("console.info");
      expect(result.bundledCode).toContain("console.warn");
      expect(result.bundledCode).toContain("console.error");
    });
  });

  describe("resolver", () => {
    it("bundles a resolver with validation wrapper", async () => {
      const sourceFile = path.join(testDir, "resolver.ts");
      fs.writeFileSync(
        sourceFile,
        `
export default {
  operation: "query",
  name: "add",
  body: (ctx: any) => ctx.input.a + ctx.input.b,
  output: { type: "integer", metadata: {} },
};
`,
      );

      const detected: DetectedFunction = { type: "resolver", name: "add" };
      const result = await bundleForTestRun({
        detected,
        sourceFile,
        machineUser: defaultMachineUser,
        workspaceId: defaultWorkspaceId,
      });

      expect(result.scriptName).toBe("test-run--add.js");
      // Check bundled code structure (can't import because it references @tailor-platform/sdk)
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("export");
      // Validation wrapper should be present
      expect(result.bundledCode).toContain("input");
    });

    it("embeds machine user as user context", async () => {
      const sourceFile = path.join(testDir, "resolver-user.ts");
      fs.writeFileSync(
        sourceFile,
        `
export default {
  operation: "query",
  name: "userInfo",
  body: (ctx: any) => ctx.user,
  output: { type: "string", metadata: {} },
};
`,
      );

      const detected: DetectedFunction = { type: "resolver", name: "userInfo" };
      const result = await bundleForTestRun({
        detected,
        sourceFile,
        machineUser: defaultMachineUser,
        workspaceId: defaultWorkspaceId,
      });

      expect(result.bundledCode).toContain("machine_user");
      expect(result.bundledCode).toContain("ADMIN");
      expect(result.bundledCode).toContain(defaultMachineUser.id);
      expect(result.bundledCode).toContain(defaultWorkspaceId);
    });

    it("embeds machine user with null attributes (external auth)", async () => {
      const sourceFile = path.join(testDir, "resolver-ext.ts");
      fs.writeFileSync(
        sourceFile,
        `
export default {
  operation: "query",
  name: "ext",
  body: (ctx: any) => ctx.user,
  output: { type: "string", metadata: {} },
};
`,
      );

      const detected: DetectedFunction = { type: "resolver", name: "ext" };
      const machineUser: ResolvedMachineUser = {
        name: "external-user",
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        attributes: null,
        attributeList: [],
      };
      const result = await bundleForTestRun({
        detected,
        sourceFile,
        machineUser,
        workspaceId: defaultWorkspaceId,
      });

      expect(result.bundledCode).toContain("machine_user");
      expect(result.bundledCode).toContain(defaultWorkspaceId);
    });
  });

  describe("executor", () => {
    it("bundles an executor extracting operation.body", async () => {
      const sourceFile = path.join(testDir, "executor.ts");
      fs.writeFileSync(
        sourceFile,
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
      );

      const detected: DetectedFunction = { type: "executor", name: "test-executor" };
      const result = await bundleForTestRun({
        detected,
        sourceFile,
        machineUser: defaultMachineUser,
        workspaceId: defaultWorkspaceId,
      });

      expect(result.scriptName).toBe("test-run--test-executor.js");
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("export");

      const tempFile = path.join(testDir, "verify-executor.mjs");
      fs.writeFileSync(tempFile, result.bundledCode);
      const mod = await import(pathToFileURL(tempFile).href);
      expect(typeof mod.main).toBe("function");
    });

    it("embeds machine user as actor context", async () => {
      const sourceFile = path.join(testDir, "executor-actor.ts");
      fs.writeFileSync(
        sourceFile,
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
      );

      const detected: DetectedFunction = { type: "executor", name: "test-actor" };
      const result = await bundleForTestRun({
        detected,
        sourceFile,
        machineUser: defaultMachineUser,
        workspaceId: defaultWorkspaceId,
      });

      expect(result.bundledCode).toContain("USER_TYPE_MACHINE_USER");
      expect(result.bundledCode).toContain("ADMIN");
      expect(result.bundledCode).toContain(defaultMachineUser.id);
      expect(result.bundledCode).toContain(defaultWorkspaceId);
    });
  });

  describe("workflow job", () => {
    it("bundles a workflow job with env injection", async () => {
      const sourceFile = path.join(testDir, "workflow.ts");
      fs.writeFileSync(
        sourceFile,
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
      );

      const detected: DetectedFunction = {
        type: "workflow-job",
        name: "my-job",
        exportName: "my_job",
      };
      const env = { APP_URL: "https://example.com", DEBUG: true };
      const result = await bundleForTestRun({
        detected,
        sourceFile,
        env,
        machineUser: defaultMachineUser,
        workspaceId: defaultWorkspaceId,
      });

      expect(result.scriptName).toBe("test-run--my-job.js");
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("https://example.com");

      const tempFile = path.join(testDir, "verify-workflow.mjs");
      fs.writeFileSync(tempFile, result.bundledCode);
      const mod = await import(pathToFileURL(tempFile).href);
      expect(typeof mod.main).toBe("function");
    });
  });
});
