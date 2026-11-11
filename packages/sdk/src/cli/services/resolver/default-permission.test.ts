import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { getErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { makeTempDir } from "#/cli/shared/test-helpers/temp-dir";
import { resolveResolverDefaultPermissionForFile } from "./default-permission";
import type { ResolverServiceConfig, ResolverServiceInput } from "#/configure/config/types";

describe("resolveResolverDefaultPermissionForFile", () => {
  let baseDir: string;
  let configPath: string;

  aroundEach(async (runTest) => {
    baseDir = makeTempDir("sdk-default-permission-");
    configPath = path.join(baseDir, "tailor.config.ts");
    fs.mkdirSync(path.join(baseDir, "main"), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "public"), { recursive: true });
    fs.writeFileSync(path.join(baseDir, "main", "guarded.ts"), "export default {};\n");
    fs.writeFileSync(path.join(baseDir, "public", "open.ts"), "export default {};\n");
    await runTest();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  const loggedIn = [
    { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
  ] as const satisfies ResolverServiceConfig["defaultPermission"];

  function config(): ResolverServiceInput {
    return {
      main: { files: ["./main/*.ts"], defaultPermission: loggedIn },
      public: { files: ["./public/*.ts"], defaultPermission: "allowAnonymous" },
      remote: { external: true },
    };
  }

  test("returns the default of the namespace whose patterns match the file", () => {
    expect(
      resolveResolverDefaultPermissionForFile({
        config: config(),
        filePath: path.join(baseDir, "main", "guarded.ts"),
        baseDir,
        configPath,
      }),
    ).toEqual(loggedIn);

    expect(
      resolveResolverDefaultPermissionForFile({
        config: config(),
        filePath: path.join(baseDir, "public", "open.ts"),
        baseDir,
        configPath,
      }),
    ).toBe("allowAnonymous");
  });

  test("rejects a file claimed by more than one namespace", () => {
    const overlapping: ResolverServiceInput = {
      main: { files: ["./main/*.ts"], defaultPermission: loggedIn },
      everything: { files: ["./**/*.ts"], defaultPermission: "allowAnonymous" },
    };

    const resolverFile = path.join(baseDir, "main", "guarded.ts");
    let error: unknown;
    try {
      resolveResolverDefaultPermissionForFile({
        config: overlapping,
        filePath: resolverFile,
        baseDir,
        configPath,
      });
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toMatchObject({
      code: "RESOLVER_NAMESPACE_AMBIGUOUS",
      message: expect.stringMatching(
        /^Resolver .*guarded\.ts matches more than one resolver namespace: "main", "everything"$/,
      ),
      suggestion: expect.stringContaining("Narrow the `files` patterns"),
      context: { file: configPath, resolverFile, namespaces: ["main", "everything"] },
    });
    expect(getErrorDiagnostics(error as Error).location).toEqual({ file: configPath });
  });

  test("returns undefined when no namespace claims the file", () => {
    fs.writeFileSync(path.join(baseDir, "loose.ts"), "export default {};\n");

    expect(
      resolveResolverDefaultPermissionForFile({
        config: config(),
        filePath: path.join(baseDir, "loose.ts"),
        baseDir,
        configPath,
      }),
    ).toBeUndefined();
  });

  test("returns undefined when the config declares no resolver namespaces", () => {
    expect(
      resolveResolverDefaultPermissionForFile({
        config: undefined,
        filePath: path.join(baseDir, "main", "guarded.ts"),
        baseDir,
        configPath,
      }),
    ).toBeUndefined();
  });

  function rejection(defaultPermission: ResolverServiceConfig["defaultPermission"]): unknown {
    try {
      resolveResolverDefaultPermissionForFile({
        config: { main: { files: ["./main/*.ts"], defaultPermission } },
        filePath: path.join(baseDir, "main", "guarded.ts"),
        baseDir,
        configPath,
      });
    } catch (error) {
      return error;
    }
    throw new Error("expected resolveResolverDefaultPermissionForFile to throw");
  }

  test("reports an invalid default as CONFIG_INVALID at the config file", () => {
    const error = rejection([{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: false }]);

    expect(error).toMatchObject({
      code: "CONFIG_INVALID",
      message: expect.stringMatching(
        /^Invalid config for resolver namespace "main":\n {2}- resolver\.main\.defaultPermission: Resolver permission must include at least one `permit: true` policy/,
      ),
      context: {
        file: configPath,
        exportName: "default",
        configKey: "resolver",
        name: "main",
        issues: [{ path: ["resolver", "main", "defaultPermission"] }],
      },
    });
  });

  test("reports each `input` operand of a default with its path", () => {
    const error = rejection([
      {
        conditions: [
          [{ input: "ownerId" }, "=", { user: "id" }],
          [{ user: "id" }, "=", { input: "reviewerId" }],
        ],
        permit: true,
      },
      { conditions: [{ input: "ownerId" }, "=", { user: "id" }], permit: true },
    ] as never);

    const message =
      "`defaultPermission` cannot use an `input` operand, since a namespace has no input; " +
      "declare it in each resolver's own `permission`";
    const prefix = ["resolver", "main", "defaultPermission"];
    expect(error).toMatchObject({
      code: "CONFIG_INVALID",
      context: {
        issues: [
          { path: [...prefix, 0, "conditions", 0, 0], message },
          { path: [...prefix, 0, "conditions", 1, 2], message },
          { path: [...prefix, 1, "conditions", 0], message },
        ],
      },
    });
  });

  test("reports an `input` operand together with the default's other issues", () => {
    const error = rejection([
      { conditions: [[{ input: "ownerId" }, "=", { user: "id" }]], permit: false },
    ] as never);

    const prefix = ["resolver", "main", "defaultPermission"];
    expect(error).toMatchObject({
      context: {
        issues: [
          { path: [...prefix, 0, "conditions"] },
          { path: prefix },
          { path: [...prefix, 0, "conditions", 0, 0] },
        ],
      },
    });
  });
});
