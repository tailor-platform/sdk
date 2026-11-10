import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { createResolverService } from "./service";

describe("createResolverService.loadResolvers", () => {
  let tmpDir: string | undefined;

  aroundEach(async (runTest) => {
    await runTest();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function writeResolver(name: string, source: string): string {
    if (!tmpDir) {
      // Place fixtures inside the SDK package so dynamic `import()` can resolve
      // `@tailor-platform/sdk` via the workspace node_modules tree. os.tmpdir()
      // would put them outside the workspace and break module resolution for
      // tests that exercise the actual import path.
      tmpDir = fs.realpathSync(
        fs.mkdtempSync(path.join(import.meta.dirname, ".resolver-service-")),
      );
    }
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, source);
    return file;
  }

  function resolverSource(name: string): string {
    return `
import { createResolver, t } from "@tailor-platform/sdk";
export default createResolver({
  name: "${name}",
  operation: "query",
  body: () => 1,
  output: t.int(),
});
`;
  }

  test("loads resolvers with distinct names", async () => {
    const fileA = writeResolver("a.ts", resolverSource("resolver-a"));
    const fileB = writeResolver("b.ts", resolverSource("resolver-b"));

    const service = createResolverService("ns", { files: [fileA, fileB] }, process.cwd());
    await service.loadResolvers();

    expect(
      Object.values(service.resolvers)
        .map((r) => r.name)
        .toSorted(),
    ).toEqual(["resolver-a", "resolver-b"]);
  });

  test("reports a resolver that fails validation as DEFINITION_INVALID", async () => {
    const file = writeResolver(
      "invalid.ts",
      `
import { createResolver, t } from "@tailor-platform/sdk";
const resolver = createResolver({ name: "invalid", operation: "query", body: () => 1, output: t.int() });
resolver.operation = "bogus";
export default resolver;
`,
    );

    const service = createResolverService("ns", { files: [file] }, process.cwd());
    using _logger = silenceLogger("error");
    await expect(service.loadResolvers()).rejects.toMatchObject({
      code: "DEFINITION_INVALID",
      message: expect.stringMatching(
        /^Invalid resolver:\n {2}- operation: Invalid input: expected "query" \| "mutation"$/,
      ),
      context: { kind: "resolver", file, exportName: "default", issues: [{ path: ["operation"] }] },
    });
    expect(vi.mocked(logger.error).mock.calls).toEqual([
      [expect.stringMatching(/Failed to load resolver from .*invalid\.ts/)],
    ]);
  });

  test("rejects two files in the same namespace declaring the same resolver name", async () => {
    const fileA = writeResolver("a.ts", resolverSource("duplicate"));
    const fileB = writeResolver("b.ts", resolverSource("duplicate"));

    const service = createResolverService("ns", { files: [fileA, fileB] }, process.cwd());

    await expect(service.loadResolvers()).rejects.toThrow(
      /Duplicate resolver name "duplicate" found in namespace "ns"/,
    );
  });

  test("does not reload after a load that yielded no resolvers", async () => {
    const file = writeResolver("not-a-resolver.ts", `export default { not: "a resolver" };\n`);
    const log = vi.spyOn(logger, "log").mockImplementation(() => {});

    const service = createResolverService("ns", { files: [file] }, process.cwd());
    await service.loadResolvers();
    await service.loadResolvers();

    const foundLogs = log.mock.calls.filter(([message]) =>
      String(message).includes("resolver files"),
    );
    log.mockRestore();
    expect(foundLogs).toHaveLength(1);
  });

  test("warns with the configured patterns when no resolver files match", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const service = createResolverService("ns", { files: ["./missing/*.ts"] }, process.cwd());
    await service.loadResolvers();

    const warnings = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(warnings).toEqual([expect.stringContaining("./missing/*.ts")]);
  });

  test("warns without patterns when the namespace configures none", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const service = createResolverService("ns", { files: [] }, process.cwd());
    await service.loadResolvers();

    const warnings = warn.mock.calls.map(([message]) => String(message));
    warn.mockRestore();
    expect(warnings).toEqual(['No resolver files found for namespace "ns"']);
  });

  test("rejects an invalid defaultPermission, naming the namespace", () => {
    expect(() =>
      createResolverService(
        "ns",
        {
          files: [],
          defaultPermission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: false }],
        },
        process.cwd(),
      ),
    ).toThrow(/Invalid `defaultPermission` for resolver namespace "ns".*permit: true/s);
  });

  test("rejects a defaultPermission that references input, naming the namespace", () => {
    expect(() =>
      createResolverService(
        "ns",
        {
          files: [],
          defaultPermission: [
            { conditions: [[{ input: "employeeId" }, "=", { user: "id" }]], permit: true },
          ] as never,
        },
        process.cwd(),
      ),
    ).toThrow(
      'Invalid `defaultPermission` for resolver namespace "ns": `defaultPermission` cannot use an `input` operand, since a namespace has no input; declare it in each resolver\'s own `permission`',
    );
  });

  test.each([
    [
      "an input operand compared to a string",
      '[{ conditions: [[{ input: "employeeId" }, "=", "u1"]], permit: true }]',
      ["permission", 0, "conditions", 0],
      "An `input` operand must be compared to a `user` operand",
    ],
    [
      "an input operand compared with !=",
      '[{ conditions: [[{ input: "employeeId" }, "!=", { user: "id" }]], permit: true }]',
      ["permission", 0, "conditions", 0],
      "An `input` operand can only be compared with `=`, since a caller can send the same ID spelled differently to pass a `!=` check",
    ],
    [
      "an input operand in a permit: false policy",
      '[{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }, { conditions: [[{ input: "employeeId" }, "=", { user: "id" }]], permit: false }]',
      ["permission", 1, "conditions"],
      "An `input` operand can only be used in a `permit: true` policy, since a condition on an omitted input never matches and so would never deny",
    ],
    [
      "an input operand naming an integer field",
      '[{ conditions: [[{ input: "count" }, "=", { user: "id" }]], permit: true }]',
      ["permission", 0, "conditions", 0, 0],
      "`permission` compares input field `count`, but only a string, uuid, or enum field that is not an array can be compared",
    ],
  ])("reports %s as DEFINITION_INVALID", async (_, permission, path, message) => {
    const file = writeResolver(
      "invalid-input-operand.ts",
      `
import { createResolver, t } from "@tailor-platform/sdk";
export default createResolver({
  name: "invalidInputOperand",
  operation: "mutation",
  input: { employeeId: t.string(), count: t.int() },
  permission: ${permission},
  body: () => 1,
  output: t.int(),
});
`,
    );

    const service = createResolverService("ns", { files: [file] }, process.cwd());
    using _logger = silenceLogger("error");
    await expect(service.loadResolvers()).rejects.toMatchObject({
      code: "DEFINITION_INVALID",
      context: { issues: [{ path, message }] },
    });
  });

  test("reports a permission input operand that names no declared input as DEFINITION_INVALID", async () => {
    const file = writeResolver(
      "unknown-input.ts",
      `
import { createResolver, t } from "@tailor-platform/sdk";
export default createResolver({
  name: "unknownInput",
  operation: "mutation",
  input: { employeeId: t.string() },
  permission: [{ conditions: [[{ input: "employeId" }, "=", { user: "id" }]], permit: true }],
  body: () => 1,
  output: t.int(),
});
`,
    );

    const service = createResolverService("ns", { files: [file] }, process.cwd());
    using _logger = silenceLogger("error");
    await expect(service.loadResolvers()).rejects.toMatchObject({
      code: "DEFINITION_INVALID",
      context: {
        kind: "resolver",
        file,
        issues: [
          {
            path: ["permission", 0, "conditions", 0, 0],
            message:
              "`permission` references input field `employeId`, which `input` does not declare",
          },
        ],
      },
    });
  });

  describe("undeclared permission warning", () => {
    let warnings: string[];

    aroundEach(async (runTest) => {
      warnings = [];
      const warn = vi.spyOn(logger, "warn").mockImplementation((message) => {
        warnings.push(String(message));
      });
      await runTest();
      warn.mockRestore();
    });

    test("warns when neither the namespace nor a resolver declares one", async () => {
      const file = writeResolver("warn.ts", resolverSource("unguarded"));

      const service = createResolverService("ns", { files: [file] }, process.cwd());
      await service.loadResolvers();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/1 of 1 resolvers declare no `permission`/);
    });

    test("stays silent when the namespace declares a defaultPermission", async () => {
      const file = writeResolver("defaulted.ts", resolverSource("inherits"));

      const service = createResolverService(
        "ns",
        { files: [file], defaultPermission: "allowAnonymous" },
        process.cwd(),
      );
      await service.loadResolvers();

      expect(warnings).toEqual([]);
    });

    test("stays silent when every resolver declares its own permission", async () => {
      const file = writeResolver(
        "declared.ts",
        `
import { createResolver, t } from "@tailor-platform/sdk";
export default createResolver({
  name: "declared",
  operation: "query",
  permission: "allowAnonymous",
  body: () => 1,
  output: t.int(),
});
`,
      );

      const service = createResolverService("ns", { files: [file] }, process.cwd());
      await service.loadResolvers();

      expect(warnings).toEqual([]);
    });
  });
});
