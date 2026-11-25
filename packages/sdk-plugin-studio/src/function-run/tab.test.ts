import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createFunctionRunTab } from "./tab";
import type { RunEvent, RunHandle } from "./run-types";

let base: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "studio-tab-")));
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
  };
}

describe("close", () => {
  test("leaves the result file saying the watch stopped because the server shut down", async () => {
    const projectDir = fs.mkdtempSync(path.join(base, "project-"));
    const tab = await createFunctionRunTab({
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
