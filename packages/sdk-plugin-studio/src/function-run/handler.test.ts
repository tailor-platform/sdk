import { describe, expect, test, vi } from "vitest";
import { createFunctionRunHandler, type RunEvent, type RunHandle } from "./handler";

const PROJECT_DIR = "/work/app";
const context = { basePath: "/plugins/function-run/", token: "tok-123" };
const root = "http://127.0.0.1:7777";

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
    const handler = createFunctionRunHandler({ projectDir: PROJECT_DIR, startRun: vi.fn() });

    test("GET / serves an HTML page that carries the token the shell passed in", async () => {
      const response = await handler(new Request(`${root}/`), context);

      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toContain("tok-123");
    });

    test("HEAD / answers without a body", async () => {
      const response = await handler(new Request(`${root}/`, { method: "HEAD" }), context);

      expect([response.status, await response.text()]).toEqual([200, ""]);
    });

    test("returns 404 for an unknown path", async () => {
      const response = await handler(new Request(`${root}/other`), context);

      expect(response.status).toBe(404);
    });

    test("GET /run is 405 so only a POST can start a run", async () => {
      const response = await handler(new Request(`${root}/run`), context);

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
      const handler = createFunctionRunHandler({
        projectDir: PROJECT_DIR,
        startRun: () => handle,
      });

      const response = await handler(post({ file: "resolvers/add.ts" }), context);

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
      const handler = createFunctionRunHandler({ projectDir: PROJECT_DIR, startRun });

      await handler(post({ file: "resolvers/add.ts", arg: '{"a":1}' }), context);

      expect(startRun).toHaveBeenCalledWith({
        file: "/work/app/resolvers/add.ts",
        arg: '{"a":1}',
      });
    });

    test("omits the argument when none is given", async () => {
      const startRun = vi.fn(() => fakeRun([]).handle);
      const handler = createFunctionRunHandler({ projectDir: PROJECT_DIR, startRun });

      await handler(post({ file: "a.ts", arg: "" }), context);

      expect(startRun).toHaveBeenCalledWith({ file: "/work/app/a.ts", arg: undefined });
    });

    test.each(["../secret.ts", "/etc/passwd", "a/../../b.ts"])(
      "rejects the file %s with 400 and starts nothing, so a run cannot reach outside the project",
      async (file) => {
        const startRun = vi.fn(() => fakeRun([]).handle);
        const handler = createFunctionRunHandler({ projectDir: PROJECT_DIR, startRun });

        const response = await handler(post({ file }), context);

        expect([response.status, startRun.mock.calls.length]).toEqual([400, 0]);
      },
    );

    test.each([
      ["a body that is not JSON", "not json"],
      ["no file", {}],
      ["an empty file", { file: "" }],
      ["a file that is not a string", { file: 1 }],
      ["an argument that is not valid JSON", { file: "a.ts", arg: "{oops" }],
      ["an argument that is not a string", { file: "a.ts", arg: 1 }],
    ])("rejects %s with 400 and starts nothing", async (_name, body) => {
      const startRun = vi.fn(() => fakeRun([]).handle);
      const handler = createFunctionRunHandler({ projectDir: PROJECT_DIR, startRun });

      const response = await handler(post(body), context);

      expect([response.status, startRun.mock.calls.length]).toEqual([400, 0]);
    });

    test("stops the run when the browser drops the request", async () => {
      const { handle, stop } = endlessRun();
      const handler = createFunctionRunHandler({
        projectDir: PROJECT_DIR,
        startRun: () => handle,
      });
      const abort = new AbortController();

      const response = await handler(post({ file: "a.ts" }, abort.signal), context);
      abort.abort();
      await response.text();

      expect(stop).toHaveBeenCalledTimes(1);
    });

    test("stops the run when the response is cancelled", async () => {
      const { handle, stop } = endlessRun();
      const handler = createFunctionRunHandler({
        projectDir: PROJECT_DIR,
        startRun: () => handle,
      });

      const response = await handler(post({ file: "a.ts" }), context);
      await response.body!.cancel();

      expect(stop).toHaveBeenCalledTimes(1);
    });

    test("reports a failure to start the run as an error event and ends the stream", async () => {
      const handler = createFunctionRunHandler({
        projectDir: PROJECT_DIR,
        startRun: () => {
          throw new Error("cannot find the tailor CLI");
        },
      });

      const response = await handler(post({ file: "a.ts" }), context);

      expect([response.status, await response.text()]).toEqual([
        500,
        "cannot find the tailor CLI\n",
      ]);
    });
  });
});
