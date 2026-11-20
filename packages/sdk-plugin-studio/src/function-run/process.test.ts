import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { functionRunArgs, resolveTailorBin, spawnRun } from "./process";
import type { RunEvent } from "./handler";

async function collect(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const all: RunEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

const node = process.execPath;

describe("spawnRun", () => {
  test("emits each stdout and stderr line as its own event, then the exit code", async () => {
    const script = [
      'process.stdout.write("one\\ntwo\\n");',
      'process.stderr.write("warn\\n");',
      "process.exitCode = 3;",
    ].join("");

    const events = await collect(spawnRun(node, ["-e", script], { cwd: process.cwd() }).events);

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "stdout", line: "one" },
        { type: "stdout", line: "two" },
        { type: "stderr", line: "warn" },
      ]),
    );
    expect(events.at(-1)).toEqual({ type: "exit", code: 3 });
  });

  test("keeps a line split across chunks together", async () => {
    const script =
      'process.stdout.write("par");setTimeout(()=>process.stdout.write("tial\\n"),30);';

    const events = await collect(spawnRun(node, ["-e", script], { cwd: process.cwd() }).events);

    expect(events.filter((event) => event.type === "stdout")).toEqual([
      { type: "stdout", line: "partial" },
    ]);
  });

  test("stop ends a process that would otherwise run on, and reports it as exited without a code", async () => {
    const handle = spawnRun(node, ["-e", "setInterval(()=>{},1000)"], { cwd: process.cwd() });

    handle.stop();
    const events = await collect(handle.events);

    expect(events).toEqual([{ type: "exit", code: null }]);
  });

  test("reports a command that cannot start as an exit without a code and the reason on stderr", async () => {
    const handle = spawnRun("/nonexistent/binary", [], { cwd: process.cwd() });

    const events = await collect(handle.events);

    expect(events.map((event) => event.type)).toEqual(["stderr", "exit"]);
  });
});

describe("functionRunArgs", () => {
  test("runs the function in watch mode with JSON output", () => {
    expect(functionRunArgs({ tailorBin: "/sdk/bin/tailor.mjs", file: "/app/a.ts" })).toEqual([
      "/sdk/bin/tailor.mjs",
      "function",
      "run",
      "/app/a.ts",
      "--watch",
      "--json",
    ]);
  });

  test("selects the workspace with the given options", () => {
    expect(
      functionRunArgs({
        tailorBin: "/sdk/bin/tailor.mjs",
        file: "/app/a.ts",
        workspaceArgs: ["-p", "test", "-w", "ws-1"],
      }),
    ).toEqual([
      "/sdk/bin/tailor.mjs",
      "function",
      "run",
      "/app/a.ts",
      "--watch",
      "--json",
      "-p",
      "test",
      "-w",
      "ws-1",
    ]);
  });

  test("passes the argument with --arg", () => {
    expect(
      functionRunArgs({ tailorBin: "/sdk/bin/tailor.mjs", file: "/app/a.ts", arg: '{"a":1}' }),
    ).toEqual([
      "/sdk/bin/tailor.mjs",
      "function",
      "run",
      "/app/a.ts",
      "--watch",
      "--json",
      "--arg",
      '{"a":1}',
    ]);
  });
});

describe("resolveTailorBin", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function project(bin: Record<string, string> | undefined) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-bin-"));
    dirs.push(dir);
    const sdk = path.join(dir, "node_modules", "@tailor-platform", "sdk");
    fs.mkdirSync(path.join(sdk, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(sdk, "package.json"),
      JSON.stringify({ name: "@tailor-platform/sdk", main: "index.js", bin }),
    );
    fs.writeFileSync(path.join(sdk, "index.js"), "");
    fs.writeFileSync(path.join(sdk, "bin", "tailor.mjs"), "");
    return dir;
  }

  test("finds the tailor entry of the SDK installed in the project", () => {
    const dir = project({ tailor: "./bin/tailor.mjs" });

    expect(fs.realpathSync(resolveTailorBin(dir))).toBe(
      fs.realpathSync(path.join(dir, "node_modules/@tailor-platform/sdk/bin/tailor.mjs")),
    );
  });

  test("fails with a clear message when the installed SDK provides no tailor command", () => {
    expect(() => resolveTailorBin(project(undefined))).toThrow("does not provide a tailor command");
  });
});
