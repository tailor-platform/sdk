import * as fs from "node:fs";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import { aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import { bundleForTestRun, type ResolvedMachineUser } from "./bundle";
import type { DetectedFunction } from "./detect";
import type * as pkgTypes from "pkg-types";

type PkgTypesModule = typeof pkgTypes;

vi.mock("pkg-types", async (importOriginal) => {
  const original = await importOriginal<PkgTypesModule>();
  return { ...original, resolveTSConfig: vi.fn(async () => undefined) };
});

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

  aroundEach(async (runTest) => {
    testDir = path.join(TEST_BASE, `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TAILOR_BUILD_OUTPUT_DIR = testDir;
    await runTest();
  });

  aroundAll(async (runSuite) => {
    await runSuite();
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
      baseDir: testDir,
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
    test("resolves tsconfig from the provided baseDir", async () => {
      vi.mocked(resolveTSConfig).mockClear();
      const detected: DetectedFunction = { type: "plain", name: "tsconfig-base" };
      await bundle(
        "tsconfig-base.ts",
        `
export default function(input: any) {
  return { hello: input.name };
}
`,
        detected,
      );

      expect(resolveTSConfig).toHaveBeenCalledWith(testDir);
    });

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
    test("resolves generated imports from the configured project directory", async () => {
      const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "function-bundler-cross-project-")),
      );
      try {
        const projectDir = path.join(root, "project");
        const dependencyDir = path.join(projectDir, "node_modules", "@tailor-platform", "sdk");
        const outputDir = path.join(root, "invocation", ".tailor-sdk");
        fs.mkdirSync(dependencyDir, { recursive: true });
        fs.writeFileSync(
          path.join(dependencyDir, "package.json"),
          JSON.stringify({
            name: "@tailor-platform/sdk",
            type: "module",
            exports: { ".": "./index.js" },
          }),
        );
        fs.writeFileSync(
          path.join(dependencyDir, "index.js"),
          "export const t = { object: () => ({ parse: ({ value }) => value }) };\n",
        );
        const sourceFile = path.join(projectDir, "resolver.ts");
        fs.writeFileSync(
          sourceFile,
          "export default { body: ({ input }: { input: unknown }) => input };\n",
        );
        process.env.TAILOR_SDK_OUTPUT_DIR = outputDir;

        const result = await bundleForTestRun({
          detected: { type: "resolver", name: "cross-project" },
          sourceFile,
          baseDir: projectDir,
          machineUser: defaultMachineUser,
          workspaceId: defaultWorkspaceId,
        });

        expect(result.bundledCode).not.toContain("@tailor-platform/sdk");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

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
      expect(result.bundledCode).toContain("main");
      expect(result.bundledCode).toContain("export");
      expect(result.bundledCode).not.toContain("@tailor-platform/sdk");
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

    test("injects the permission guard when the resolver has one", async () => {
      const detected: DetectedFunction = {
        type: "resolver",
        name: "protected",
        permission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
      };
      const result = await bundle(
        "resolver-permission.ts",
        `
export default {
  operation: "query",
  name: "protected",
  body: () => 1,
  output: { type: "integer", metadata: {} },
};
`,
        detected,
      );

      expect(result.bundledCode).toContain("TailorErrorMessage");
      expect(result.bundledCode).toContain("access denied");
    });

    test("does not inject a guard when permission is omitted", async () => {
      const detected: DetectedFunction = { type: "resolver", name: "open" };
      const result = await bundle(
        "resolver-open.ts",
        `
export default {
  operation: "query",
  name: "open",
  body: () => 1,
  output: { type: "integer", metadata: {} },
};
`,
        detected,
      );

      expect(result.bundledCode).not.toContain("TailorErrorMessage");
    });

    test("injects the namespace default when the resolver declares no permission", async () => {
      const detected: DetectedFunction = { type: "resolver", name: "inherits" };
      const result = await bundle(
        "resolver-inherits.ts",
        `
export default {
  operation: "query",
  name: "inherits",
  body: () => 1,
  output: { type: "integer", metadata: {} },
};
`,
        detected,
        {
          defaultPermission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
        },
      );

      expect(result.bundledCode).toContain("TailorErrorMessage");
      expect(result.bundledCode).toContain("access denied");
    });

    test("lets the resolver's own permission override the namespace default", async () => {
      const detected: DetectedFunction = {
        type: "resolver",
        name: "opted-out",
        permission: "allowAnonymous",
      };
      const result = await bundle(
        "resolver-opted-out.ts",
        `
export default {
  operation: "query",
  name: "opted-out",
  body: () => 1,
  output: { type: "integer", metadata: {} },
};
`,
        detected,
        {
          defaultPermission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
        },
      );

      expect(result.bundledCode).not.toContain("TailorErrorMessage");
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
