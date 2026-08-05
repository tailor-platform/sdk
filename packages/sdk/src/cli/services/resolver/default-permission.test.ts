import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { resolveResolverDefaultPermissionForFile } from "./default-permission";
import type { ResolverServiceConfig, ResolverServiceInput } from "#/configure/config/types";

describe("resolveResolverDefaultPermissionForFile", () => {
  let baseDir: string;

  aroundEach(async (runTest) => {
    baseDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sdk-default-permission-")));
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
      }),
    ).toEqual(loggedIn);

    expect(
      resolveResolverDefaultPermissionForFile({
        config: config(),
        filePath: path.join(baseDir, "public", "open.ts"),
        baseDir,
      }),
    ).toBe("allowAnonymous");
  });

  test("rejects a file claimed by more than one namespace", () => {
    const overlapping: ResolverServiceInput = {
      main: { files: ["./main/*.ts"], defaultPermission: loggedIn },
      everything: { files: ["./**/*.ts"], defaultPermission: "allowAnonymous" },
    };

    expect(() =>
      resolveResolverDefaultPermissionForFile({
        config: overlapping,
        filePath: path.join(baseDir, "main", "guarded.ts"),
        baseDir,
      }),
    ).toThrow(/matches more than one resolver namespace: "main", "everything"/);
  });

  test("returns undefined when no namespace claims the file", () => {
    fs.writeFileSync(path.join(baseDir, "loose.ts"), "export default {};\n");

    expect(
      resolveResolverDefaultPermissionForFile({
        config: config(),
        filePath: path.join(baseDir, "loose.ts"),
        baseDir,
      }),
    ).toBeUndefined();
  });

  test("returns undefined when the config declares no resolver namespaces", () => {
    expect(
      resolveResolverDefaultPermissionForFile({
        config: undefined,
        filePath: path.join(baseDir, "main", "guarded.ts"),
        baseDir,
      }),
    ).toBeUndefined();
  });
});
