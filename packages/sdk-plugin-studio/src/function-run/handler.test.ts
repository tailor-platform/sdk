import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createSyncedFiles } from "./files";
import { createFunctionRunHandler } from "./handler";
import { createRunSession } from "./session";
import type { RunEvent, RunHandle, RunInput } from "./run-types";

const token = "tok-123";
const root = "http://127.0.0.1:7777";
const context = { basePath: "/plugins/function-run/", token, getSelection: () => ({}) };
const pageTemplate = "<html><head><title>Function run</title></head></html>";

let base: string;
let dir: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "studio-handler-")));
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(base, "case-"));
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function controllableRun() {
  const queue: RunEvent[] = [];
  let wake: (() => void) | undefined;
  const push = (event: RunEvent) => {
    queue.push(event);
    wake?.();
  };
  const stop = vi.fn(() => push({ type: "exit", code: null }));
  const handle: RunHandle = {
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
    stop,
  };
  return { handle, push, stop };
}

async function setup(options: { selection?: { profile?: string; workspaceId?: string } } = {}) {
  const selection = options.selection ?? { profile: "test", workspaceId: "ws-1" };
  const run = controllableRun();
  const startRun = vi.fn((_input: RunInput) => run.handle);
  const files = createSyncedFiles({
    file: path.join(dir, "studio", "function.ts"),
    argFile: path.join(dir, "studio", "function.arg.json5"),
    runArgFile: path.join(dir, "run", "arg.json"),
    starter: "export default 1;\n",
    formatCode: async (code) => code.replace(/\s+/g, " ").trim(),
    pollMs: 0,
  });
  await files.init();
  const session = createRunSession({
    startRun,
    file: path.join(dir, "studio", "function.ts"),
    runArgFile: path.join(dir, "run", "arg.json"),
    getSelection: () => selection,
  });
  const handler = createFunctionRunHandler({
    loadPage: async () => pageTemplate,
    files,
    session,
    paths: { file: "studio/function.ts", argFile: "studio/function.arg.json5" },
  });
  return { handler, files, session, run, startRun };
}

const send = (
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`${root}${pathname}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });

const events = (abort?: AbortController) =>
  new Request(`${root}/events`, {
    headers: { "x-tailor-studio-token": token },
    signal: abort?.signal,
  });

async function readFrames(
  response: Response,
  until: (frames: string[]) => boolean,
): Promise<string[]> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const frames: string[] = [];
  let buffer = "";
  const give = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1500));
  while (!until(frames)) {
    const next = await Promise.race([reader.read(), give]);
    if (next === "timeout" || next.done) break;
    buffer += next.value;
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    frames.push(...parts);
  }
  await reader.cancel();
  return frames;
}

const eventNames = (frames: string[]) => frames.map((frame) => frame.split("\n")[0]);
const dataOf = (frame: string) => JSON.parse(frame.split("\n")[1]!.slice(6));

describe("GET /", () => {
  test("serves the page with the token the shell hands over", async () => {
    const { handler } = await setup();

    const response = await handler(new Request(`${root}/`), context);

    expect([
      response.headers.get("content-type"),
      response.headers.get("cache-control"),
      await response.text(),
    ]).toEqual([
      "text/html; charset=utf-8",
      "no-store",
      '<html><head><meta name="tailor-studio-token" content="tok-123"><title>Function run</title></head></html>',
    ]);
  });

  test("answers HEAD without a body", async () => {
    const { handler } = await setup();

    const response = await handler(new Request(`${root}/`, { method: "HEAD" }), context);

    expect([response.status, await response.text()]).toEqual([200, ""]);
  });

  test("answers 500 when the page cannot be loaded", async () => {
    const { files, session } = await setup();
    const handler = createFunctionRunHandler({
      loadPage: async () => {
        throw new Error("page missing");
      },
      files,
      session,
      paths: { file: "f", argFile: "a" },
    });

    const response = await handler(new Request(`${root}/`), context);

    expect([response.status, await response.text()]).toEqual([500, "page missing\n"]);
  });

  test("answers 404 for a path it does not serve", async () => {
    const { handler } = await setup();

    const response = await handler(new Request(`${root}/other`), context);

    expect(response.status).toBe(404);
  });
});

describe("GET /events", () => {
  test("is refused without the token", async () => {
    const { handler } = await setup();

    const response = await handler(new Request(`${root}/events`), context);

    expect(response.status).toBe(403);
  });

  test("starts with the state: where the files are, what they hold and whether it is watching", async () => {
    const { handler } = await setup();

    const response = await handler(events(), context);
    const [first] = await readFrames(response, (frames) => frames.length >= 1);

    expect([response.headers.get("content-type"), first!.split("\n")[0], dataOf(first!)]).toEqual([
      "text/event-stream",
      "event: state",
      {
        file: "studio/function.ts",
        argFile: "studio/function.arg.json5",
        code: "export default 1;\n",
        arg: "",
        status: "idle",
        running: false,
      },
    ]);
  });

  test("tells the page the absolute paths too, so it can offer them for copying", async () => {
    const { files, session } = await setup();
    const handler = createFunctionRunHandler({
      loadPage: async () => pageTemplate,
      files,
      session,
      paths: {
        file: "studio/function.ts",
        argFile: "studio/function.arg.json5",
        resultFile: "studio/function.result.json",
        absolute: {
          file: "/p/studio/function.ts",
          argFile: "/p/studio/function.arg.json5",
          resultFile: "/p/studio/function.result.json",
        },
      },
    });

    const response = await handler(events(), context);
    const [first] = await readFrames(response, (frames) => frames.length >= 1);

    expect(dataOf(first!)).toMatchObject({
      resultFile: "studio/function.result.json",
      absolute: {
        file: "/p/studio/function.ts",
        argFile: "/p/studio/function.arg.json5",
        resultFile: "/p/studio/function.result.json",
      },
    });
  });

  test("replays what the run already printed, then goes on with what it prints next", async () => {
    const { handler, session, run } = await setup();
    session.start();
    run.push({ type: "stderr", line: "Ready! Running f.ts" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = await handler(events(), context);
    const pending = readFrames(response, (frames) => frames.length >= 3);
    run.push({ type: "stdout", line: '{"success":true,"result":"3"}' });
    const frames = await pending;

    expect(eventNames(frames)).toEqual(["event: state", "event: entry", "event: entry"]);
    expect(dataOf(frames[1]!).message).toEqual({ type: "note", text: "Ready! Running f.ts" });
    expect(dataOf(frames[2]!).message).toEqual({
      type: "run",
      record: { success: true, result: "3" },
    });
  });

  test("tells a page that the watch started and stopped", async () => {
    const { handler } = await setup();
    const response = await handler(events(), context);
    const pending = readFrames(response, (frames) => frames.length >= 4);

    await handler(send("POST", "/start"), context);
    await handler(send("POST", "/stop"), context);
    const frames = await pending;

    expect(eventNames(frames)).toEqual([
      "event: state",
      "event: reset",
      "event: status",
      "event: status",
    ]);
    expect([dataOf(frames[2]!).status, dataOf(frames[3]!).status]).toEqual(["watching", "stopped"]);
  });

  test("tells a page what was changed in the files from outside", async () => {
    const { handler, files } = await setup();
    const response = await handler(events(), context);
    const pending = readFrames(response, (frames) => frames.length >= 2);

    fs.writeFileSync(path.join(dir, "studio", "function.ts"), "edited elsewhere");
    await files.refresh();
    const frames = await pending;

    expect([frames[1]!.split("\n")[0], dataOf(frames[1]!)]).toEqual([
      "event: file",
      { code: "edited elsewhere" },
    ]);
  });
});

describe("PUT /file", () => {
  test("writes the code and the argument", async () => {
    const { handler, files } = await setup();

    const response = await handler(send("PUT", "/file", { code: "typed", arg: "{a: 1}" }), context);

    expect([response.status, files.read()]).toEqual([204, { code: "typed", arg: "{a: 1}" }]);
  });

  test("writes only what it is given", async () => {
    const { handler, files } = await setup();

    await handler(send("PUT", "/file", { arg: "{a: 1}" }), context);

    expect(files.read()).toEqual({ code: "export default 1;\n", arg: "{a: 1}" });
  });

  test.each([
    ["a body that is not JSON", "not json"],
    ["code that is not a string", { code: 1 }],
    ["an argument that is not a string", { arg: 1 }],
    ["an argument that does not parse", { arg: "{oops" }],
    ["neither code nor argument", {}],
  ])("rejects %s with 400 and writes nothing", async (_name, body) => {
    const { handler, files } = await setup();

    const response = await handler(send("PUT", "/file", body), context);

    expect([response.status, files.read()]).toEqual([
      400,
      { code: "export default 1;\n", arg: "" },
    ]);
  });

  test("is 405 unless it is a PUT", async () => {
    const { handler } = await setup();

    const response = await handler(send("POST", "/file", {}), context);

    expect([response.status, response.headers.get("allow")]).toEqual([405, "PUT"]);
  });
});

describe("POST /start and /stop", () => {
  test("starts the watch against the workspace selected in the shell", async () => {
    const { handler, startRun } = await setup();

    const response = await handler(send("POST", "/start"), context);

    expect([response.status, startRun.mock.calls[0]![0].workspaceArgs]).toEqual([
      204,
      ["-p", "test", "-w", "ws-1"],
    ]);
  });

  test("asks for a workspace with 409 and starts nothing while none is selected", async () => {
    const { handler, startRun } = await setup({ selection: {} });

    const response = await handler(send("POST", "/start"), context);

    expect([response.status, await response.text(), startRun.mock.calls.length]).toEqual([
      409,
      "Select a workspace in the bar at the top of the page.\n",
      0,
    ]);
  });

  test("stops the watch", async () => {
    const { handler, run } = await setup();
    await handler(send("POST", "/start"), context);

    const response = await handler(send("POST", "/stop"), context);

    expect([response.status, run.stop.mock.calls.length]).toEqual([204, 1]);
  });

  test("is 405 unless it is a POST", async () => {
    const { handler } = await setup();

    const response = await handler(new Request(`${root}/start`), context);

    expect([response.status, response.headers.get("allow")]).toEqual([405, "POST"]);
  });
});

describe("close", () => {
  test("stops the watch", async () => {
    const { handler, run } = await setup();
    await handler(send("POST", "/start"), context);

    handler.close();

    expect(run.stop.mock.calls.length).toBe(1);
  });
});
