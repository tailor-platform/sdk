import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createFunctionRun } from "./function-run";
import type { RunEvent, RunHandle } from "./run-types";

let base: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "function-run-")));
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function idleRun(): RunHandle {
  const queue: RunEvent[] = [];
  let wake: (() => void) | undefined;
  return {
    events: (async function* () {
      for (;;) {
        const event = queue.shift();
        if (event === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        yield event;
        if (event.type === "exit") return;
      }
    })(),
    stop: () => {
      queue.push({ type: "exit", code: null });
      wake?.();
    },
    exited: Promise.resolve(),
  };
}

describe("close", () => {
  test("leaves the result file saying the watch stopped because the server shut down", async () => {
    const projectDir = fs.mkdtempSync(path.join(base, "project-"));
    const tab = await createFunctionRun({
      projectDir,
      watch: true,
      getSelection: () => ({ profile: "test" }),
      onSelectionChange: () => () => {},
      pageFile: path.join(projectDir, "page.html"),
      startRun: idleRun,
    });
    const resultFile = path.join(projectDir, tab.paths.resultFile);
    const before = JSON.parse(fs.readFileSync(resultFile, "utf8"));

    tab.close();

    const after = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    expect([before.status, before.running, after.status, after.running, after.reason]).toEqual([
      "watching",
      true,
      "stopped",
      false,
      "The server was shut down.",
    ]);
  });
});

describe("a function file that is a symbolic link", () => {
  test("edits the file the link points to, so a save does not replace the link", async () => {
    const projectDir = fs.mkdtempSync(path.join(base, "project-"));
    const target = path.join(projectDir, "real", "fn.ts");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "export default 1;\n");
    const link = path.join(projectDir, "link.ts");
    fs.symlinkSync(target, link);
    const tab = await createFunctionRun({
      projectDir,
      file: "link.ts",
      watch: false,
      getSelection: () => ({}),
      onSelectionChange: () => () => {},
      pageFile: path.join(projectDir, "page.html"),
      startRun: idleRun,
    });

    await tab.handler(
      new Request("http://127.0.0.1:7777/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "export default 2;\n" }),
      }),
    );
    tab.close();

    expect([
      fs.lstatSync(link).isSymbolicLink(),
      fs.readFileSync(target, "utf8"),
      tab.paths.absolute?.file,
    ]).toEqual([true, "export default 2;\n", fs.realpathSync(target)]);
  });
});
