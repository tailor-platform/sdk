import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createFunctionRunHandler, type RunEvent, type RunHandle, type RunInput } from "./handler";

const context = { basePath: "/plugins/function-run/", token: "tok-123" };
const root = "http://127.0.0.1:7777";

let base: string;
let projectDir: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "studio-run-")));
  projectDir = path.join(base, "app");
  const outside = path.join(base, "outside");
  fs.mkdirSync(path.join(projectDir, "resolvers"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(projectDir, "a.ts"), "");
  fs.writeFileSync(path.join(projectDir, "b.ts"), "");
  fs.writeFileSync(path.join(projectDir, "resolvers", "add.ts"), "");
  fs.writeFileSync(path.join(outside, "secret.ts"), "");
  fs.symlinkSync(path.join(outside, "secret.ts"), path.join(projectDir, "link.ts"));
  fs.symlinkSync(outside, path.join(projectDir, "linkdir"));
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function fakeRun(events: RunEvent[]) {
  const stop = vi.fn();
  const handle: RunHandle = {
    events: (async function* () {
      yield* events;
    })(),
    stop,
  };
  return { handle, stop };
}

function endlessRun() {
  let finish: () => void = () => undefined;
  const stop = vi.fn(() => finish());
  const handle: RunHandle = {
    events: (async function* () {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      yield { type: "exit", code: null } as const;
    })(),
    stop,
  };
  return { handle, stop };
}

function handlerWith(startRun: (input: RunInput) => RunHandle) {
  return createFunctionRunHandler({ projectDir, startRun });
}

function post(body: unknown, signal?: AbortSignal) {
  return new Request(`${root}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });
}

describe("createFunctionRunHandler", () => {
  describe("page", () => {
    test("GET / serves an HTML page that carries the token the shell passed in", async () => {
      const response = await handlerWith(vi.fn())(new Request(`${root}/`), context);

      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toContain("tok-123");
    });

    test("HEAD / answers without a body", async () => {
      const response = await handlerWith(vi.fn())(
        new Request(`${root}/`, { method: "HEAD" }),
        context,
      );

      expect([response.status, await response.text()]).toEqual([200, ""]);
    });

    test("returns 404 for an unknown path", async () => {
      const response = await handlerWith(vi.fn())(new Request(`${root}/other`), context);

      expect(response.status).toBe(404);
    });

    test("GET /run is 405 so only a POST can start a run", async () => {
      const response = await handlerWith(vi.fn())(new Request(`${root}/run`), context);

      expect([response.status, response.headers.get("allow")]).toEqual([405, "POST"]);
    });
  });

  describe("POST /run", () => {
    test("streams the run's lines and its exit as server-sent events", async () => {
      const { handle } = fakeRun([
        { type: "stdout", line: '{"executionId":"e1","success":true}' },
        { type: "stderr", line: "warning: slow" },
        { type: "exit", code: 0 },
      ]);

      const response = await handlerWith(() => handle)(post({ file: "a.ts" }), context);

      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(await response.text()).toBe(
        [
          'event: stdout\ndata: {"executionId":"e1","success":true}\n\n',
          "event: stderr\ndata: warning: slow\n\n",
          'event: exit\ndata: {"code":0}\n\n',
        ].join(""),
      );
    });

    test("starts the run with the file resolved against the project directory and the argument", async () => {
      const startRun = vi.fn(() => fakeRun([]).handle);

      await handlerWith(startRun)(post({ file: "resolvers/add.ts", arg: '{"a":1}' }), context);

      expect(startRun).toHaveBeenCalledWith({
        file: path.join(projectDir, "resolvers", "add.ts"),
        arg: '{"a":1}',
      });
    });

    test("omits the argument when none is given", async () => {
      const startRun = vi.fn(() => fakeRun([]).handle);

      await handlerWith(startRun)(post({ file: "a.ts", arg: "" }), context);

      expect(startRun).toHaveBeenCalledWith({
        file: path.join(projectDir, "a.ts"),
        arg: undefined,
      });
    });

    test.each([
      ["a path above the project", "../secret.ts"],
      ["an absolute path elsewhere", "/etc/passwd"],
      ["a path that climbs out and back", "a/../../b.ts"],
      ["a symlink to a file outside the project", "link.ts"],
      ["a path through a symlinked directory", "linkdir/secret.ts"],
    ])(
      "rejects %s with 400 and starts nothing, so a run cannot reach outside the project",
      async (_name, file) => {
        const startRun = vi.fn(() => fakeRun([]).handle);

        const response = await handlerWith(startRun)(post({ file }), context);

        expect([response.status, startRun.mock.calls.length]).toEqual([400, 0]);
      },
    );

    test("rejects a file that does not exist with 400 and starts nothing", async () => {
      const startRun = vi.fn(() => fakeRun([]).handle);

      const response = await handlerWith(startRun)(post({ file: "missing.ts" }), context);

      expect([response.status, startRun.mock.calls.length]).toEqual([400, 0]);
    });

    test.each([
      ["a body that is not JSON", "not json"],
      ["no file", {}],
      ["an empty file", { file: "" }],
      ["a file that is not a string", { file: 1 }],
      ["an argument that is not valid JSON", { file: "a.ts", arg: "{oops" }],
      ["an argument that is not a string", { file: "a.ts", arg: 1 }],
    ])("rejects %s with 400 and starts nothing", async (_name, body) => {
      const startRun = vi.fn(() => fakeRun([]).handle);

      const response = await handlerWith(startRun)(post(body), context);

      expect([response.status, startRun.mock.calls.length]).toEqual([400, 0]);
    });

    test("stops the run when the browser drops the request", async () => {
      const { handle, stop } = endlessRun();
      const abort = new AbortController();

      const response = await handlerWith(() => handle)(
        post({ file: "a.ts" }, abort.signal),
        context,
      );
      abort.abort();
      await response.text();

      expect(stop).toHaveBeenCalledTimes(1);
    });

    test("stops the run when the response is cancelled", async () => {
      const { handle, stop } = endlessRun();

      const response = await handlerWith(() => handle)(post({ file: "a.ts" }), context);
      await response.body!.cancel();

      expect(stop).toHaveBeenCalledTimes(1);
    });

    test("answers 500 with the reason when the run cannot be started", async () => {
      const handler = handlerWith(() => {
        throw new Error("cannot find the tailor CLI");
      });

      const response = await handler(post({ file: "a.ts" }), context);

      expect([response.status, await response.text()]).toEqual([
        500,
        "cannot find the tailor CLI\n",
      ]);
    });
  });

  describe("one watch per file", () => {
    test("refuses a second run of a file that is already being watched, so one save cannot run it twice", async () => {
      const first = endlessRun();
      const startRun = vi.fn(() => first.handle);
      const handler = handlerWith(startRun);

      await handler(post({ file: "a.ts" }), context);
      const second = await handler(post({ file: "a.ts" }), context);

      expect([second.status, startRun.mock.calls.length]).toEqual([409, 1]);
    });

    test("allows watching a different file at the same time", async () => {
      const startRun = vi.fn(() => endlessRun().handle);
      const handler = handlerWith(startRun);

      await handler(post({ file: "a.ts" }), context);
      const other = await handler(post({ file: "b.ts" }), context);

      expect([other.status, startRun.mock.calls.length]).toEqual([200, 2]);
    });

    test("allows the file again once its run has ended", async () => {
      const first = endlessRun();
      const startRun = vi
        .fn<(input: RunInput) => RunHandle>()
        .mockReturnValueOnce(first.handle)
        .mockReturnValue(fakeRun([]).handle);
      const handler = handlerWith(startRun);
      const abort = new AbortController();

      const running = await handler(post({ file: "a.ts" }, abort.signal), context);
      abort.abort();
      await running.text();
      const again = await handler(post({ file: "a.ts" }), context);

      expect(again.status).toBe(200);
    });

    test("allows the file again after a run failed to start", async () => {
      const startRun = vi
        .fn<(input: RunInput) => RunHandle>()
        .mockImplementationOnce(() => {
          throw new Error("boom");
        })
        .mockReturnValue(fakeRun([]).handle);
      const handler = handlerWith(startRun);

      await handler(post({ file: "a.ts" }), context);
      const again = await handler(post({ file: "a.ts" }), context);

      expect(again.status).toBe(200);
    });
  });
});
