import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { typecheckCompiler } from "./typecheck-native";

const runner = fileURLToPath(new URL("./typecheck-native.ts", import.meta.url));

describe("native typecheck", () => {
  test.each([
    ["darwin", "arm64", "tsrs"],
    ["linux", "x64", "tsrs"],
    ["linux", "arm64", "tsrs"],
    ["darwin", "x64", "typescript"],
    ["win32", "x64", "typescript"],
    ["win32", "arm64", "typescript"],
    ["linux", "arm", "typescript"],
    ["freebsd", "x64", "typescript"],
  ] as const)("selects %s/%s compiler %s", (platform, arch, compiler) => {
    expect(typecheckCompiler(platform, arch)).toBe(compiler);
  });

  test.each([0, 2])("preserves compiler exit code %s and arguments", (exitCode) => {
    const fixture = mkdtempSync(join(tmpdir(), "native-typecheck-"));
    try {
      for (const [name, bin] of [
        ["tsrs", "bin/tsrs"],
        ["typescript", "lib/tsc.js"],
      ] as const) {
        const packageRoot = join(fixture, "node_modules", name);
        mkdirSync(join(packageRoot, dirname(bin)), { recursive: true });
        writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name }));
        writeFileSync(
          join(packageRoot, bin),
          `console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = ${name === typecheckCompiler(process.platform, process.arch) ? exitCode : 99};`,
        );
      }
      const result = spawnSync(process.execPath, [runner], {
        cwd: fixture,
        encoding: "utf8",
        env: { ...process.env, NODE_PATH: "" },
      });
      expect(result.status).toBe(exitCode);
      expect(JSON.parse(result.stdout)).toEqual([
        "--noEmit",
        "--tsBuildInfoFile",
        "./.tsrs.tsbuildinfo",
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("fails when the selected compiler cannot be loaded", () => {
    const fixture = mkdtempSync(join(tmpdir(), "native-typecheck-missing-"));
    try {
      const result = spawnSync(process.execPath, [runner], {
        cwd: fixture,
        encoding: "utf8",
        env: { ...process.env, NODE_PATH: "" },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("MODULE_NOT_FOUND");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
