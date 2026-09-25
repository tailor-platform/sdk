import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
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
