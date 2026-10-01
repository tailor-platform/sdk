import { fstatSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { execPluginCommand } from "./plugin-exec";

let dir: string;
aroundEach(async (runTest) => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "plugin-exec-")));
  try {
    await runTest();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const node = (code: string) => `node -e ${JSON.stringify(code)}`;

describe("execPluginCommand", () => {
  test("runs the command in the working directory with the added environment variables", async () => {
    const result = await execPluginCommand(
      node("process.stdout.write(process.cwd() + '|' + process.env.PLUGIN_EXEC_VALUE)"),
      { workingDir: dir, env: { PLUGIN_EXEC_VALUE: "added" }, output: "capture" },
    );
    expect(result.stdout).toBe(`${dir}|added`);
  });

  test("returns stdout and stderr separately when capturing output", async () => {
    await expect(
      execPluginCommand(node("process.stdout.write('out'); process.stderr.write('err')"), {
        workingDir: dir,
        output: "capture",
      }),
    ).resolves.toEqual({ stdout: "out", stderr: "err" });
  });

  test("returns empty output when output is ignored", async () => {
    await expect(
      execPluginCommand(node("process.stdout.write('out'); process.stderr.write('err')"), {
        workingDir: dir,
        output: "ignore",
      }),
    ).resolves.toEqual({ stdout: "", stderr: "" });
  });

  test("reports the command, working directory, and exit code when the command fails", async () => {
    const command = node("process.exit(7)");
    await expect(execPluginCommand(command, { workingDir: dir })).rejects.toMatchObject({
      code: "PLUGIN_COMMAND_FAILED",
      message: `Command failed: ${command} (working directory: ${dir}, exit code: 7)`,
    });
  });

  test("includes the captured stderr in the failure", async () => {
    await expect(
      execPluginCommand(node("process.stderr.write('first\\nlast'); process.exit(1)"), {
        workingDir: dir,
        output: "capture",
      }),
    ).rejects.toThrow(/exit code: 1\)\nfirst\nlast$/);
  });

  test("reports a working directory that does not exist", async () => {
    const missing = path.join(dir, "missing");
    await expect(execPluginCommand("true", { workingDir: missing })).rejects.toMatchObject({
      code: "PLUGIN_COMMAND_START_FAILED",
      message: expect.stringContaining(`working directory: ${missing}`),
    });
  });
});

test("streams command output to stderr so stdout stays clean for JSON results", async () => {
  const { dev, ino } = fstatSync(2);
  const sameAsParentStderr = (fd: number) =>
    `fs.fstatSync(${fd}).dev === ${dev} && fs.fstatSync(${fd}).ino === ${ino}`;
  await expect(
    execPluginCommand(
      node(
        `const fs = require("node:fs"); process.exit(${sameAsParentStderr(1)} && ${sameAsParentStderr(2)} ? 0 : 3)`,
      ),
      { workingDir: dir },
    ),
  ).resolves.toEqual({ stdout: "", stderr: "" });
});
