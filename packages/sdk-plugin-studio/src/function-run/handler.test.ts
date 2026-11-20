import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createFunctionRunHandler, type RunEvent, type RunHandle, type RunInput } from "./handler";

const selected = { profile: "test", workspaceId: "ws-1" };
const context = {
  basePath: "/plugins/function-run/",
  token: "tok-123",
  getSelection: () => selected,
};
const root = "http://127.0.0.1:7777";

let base: string;
let projectDir: string;
let scratchRoot: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "studio-run-")));
  projectDir = path.join(base, "app");
  fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
});

beforeEach(() => {
  scratchRoot = fs.mkdtempSync(path.join(base, "scratch-"));
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

const pageTemplate = "<html><head><title>Function run</title></head></html>";

function handlerWith(
  startRun: (input: RunInput) => RunHandle,
  loadPage: () => Promise<string> = async () => pageTemplate,
  formatCode?: (code: string) => Promise<string | undefined>,
) {
  return createFunctionRunHandler({ projectDir, scratchRoot, startRun, loadPage, formatCode });
}

const collapseSpaces = async (code: string) =>
  code.includes("broken") ? undefined : code.replace(/\s+/g, " ").trim();

function post(body: unknown, signal?: AbortSignal) {
  return new Request(`${root}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });
}

function save(body: unknown) {
  return new Request(`${root}/save`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function scratchEntries(): string[] {
  return fs.readdirSync(scratchRoot);
}

describe("createFunctionRunHandler", () => {
  describe("page", () => {
    test("GET / serves the built page with the token the shell passed in", async () => {
      const response = await handlerWith(vi.fn())(new Request(`${root}/`), context);

      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toBe(
        '<html><head><meta name="tailor-studio-token" content="tok-123"><title>Function run</title></head></html>',
      );
    });

    test("GET / answers 500 with the reason when the built page cannot be read", async () => {
      const handler = handlerWith(vi.fn(), async () => {
        throw new Error("page is missing");
      });

      const response = await handler(new Request(`${root}/`), context);

      expect([response.status, await response.text()]).toEqual([500, "page is missing\n"]);
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

      const response = await handlerWith(() => handle)(post({ code: "export default 1" }), context);

      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(await response.text()).toBe(
        [
          'event: stdout\ndata: {"executionId":"e1","success":true}\n\n',
          "event: stderr\ndata: warning: slow\n\n",
          'event: exit\ndata: {"code":0}\n\n',
        ].join(""),
      );
    });

    test("runs the typed code from a scratch file outside the project that can import the project's packages", async () => {
      const startRun = vi.fn((_input: RunInput) => endlessRun().handle);

      await handlerWith(startRun)(post({ code: "export const main = () => 1;" }), context);

      const { file } = startRun.mock.calls[0]![0];
      expect([
        path.dirname(file).startsWith(scratchRoot),
        fs.readFileSync(file, "utf8"),
        fs.realpathSync(path.join(path.dirname(file), "node_modules")),
      ]).toEqual([true, "export const main = () => 1;", path.join(projectDir, "node_modules")]);
    });

    test("hands the argument to the run in a file, which holds {} when none is given", async () => {
      const seen: string[] = [];
      const handler = handlerWith((input) => {
        seen.push(fs.readFileSync(input.argFile, "utf8"));
        return fakeRun([]).handle;
      });

      await handler(post({ code: "x", arg: '{"a":1}' }), context);
      await handler(post({ code: "x", arg: "" }), context);
      await handler(post({ code: "x" }), context);

      expect(seen).toEqual(['{"a":1}', "{}", "{}"]);
    });

    test("accepts JSON5 for the argument and hands the run plain JSON", async () => {
      const seen: string[] = [];
      const handler = handlerWith((input) => {
        seen.push(fs.readFileSync(input.argFile, "utf8"));
        return fakeRun([]).handle;
      });

      await handler(post({ code: "x", arg: "{a: 1, b: 'two',}" }), context);

      expect(seen).toEqual(['{"a":1,"b":"two"}']);
    });

    test("tells the browser the run's id so it can save the code again", async () => {
      const response = await handlerWith(() => endlessRun().handle)(post({ code: "x" }), context);

      expect(response.headers.get("x-run-id")).toMatch(/^[0-9a-f-]{36}$/);
    });

    test.each([
      ["a body that is not JSON", "not json"],
      ["no code", {}],
      ["code that is not a string", { code: 1 }],
      ["an argument that is not valid JSON", { code: "x", arg: "{oops" }],
      ["an argument that is not a string", { code: "x", arg: 1 }],
    ])("rejects %s with 400 and starts nothing", async (_name, body) => {
      const startRun = vi.fn(() => fakeRun([]).handle);

      const response = await handlerWith(startRun)(post(body), context);

      expect([response.status, startRun.mock.calls.length]).toEqual([400, 0]);
    });

    test("stops the run when the browser drops the request", async () => {
      const { handle, stop } = endlessRun();
      const abort = new AbortController();

      const response = await handlerWith(() => handle)(post({ code: "x" }, abort.signal), context);
      abort.abort();
      await response.text();

      expect(stop).toHaveBeenCalledTimes(1);
    });

    test("stops the run when the response is cancelled", async () => {
      const { handle, stop } = endlessRun();

      const response = await handlerWith(() => handle)(post({ code: "x" }), context);
      await response.body!.cancel();

      expect(stop).toHaveBeenCalledTimes(1);
    });

    test("answers 500 with the reason when the run cannot be started", async () => {
      const handler = handlerWith(() => {
        throw new Error("cannot find the tailor CLI");
      });

      const response = await handler(post({ code: "x" }), context);

      expect([response.status, await response.text()]).toEqual([
        500,
        "cannot find the tailor CLI\n",
      ]);
    });
  });

  describe("scratch files", () => {
    test("removes the scratch files once the last run has ended", async () => {
      const handler = handlerWith(() => fakeRun([{ type: "exit", code: 0 }]).handle);

      const response = await handler(post({ code: "x" }), context);
      await response.text();

      expect(scratchEntries()).toEqual([]);
    });

    test("removes the scratch files when the run cannot be started", async () => {
      const handler = handlerWith(() => {
        throw new Error("boom");
      });

      await handler(post({ code: "x" }), context);

      expect(scratchEntries()).toEqual([]);
    });

    test("keeps the scratch directory while another run is still going", async () => {
      const handler = handlerWith(() => endlessRun().handle);
      const abort = new AbortController();
      const first = await handler(post({ code: "a" }, abort.signal), context);
      await handler(post({ code: "b" }), context);

      abort.abort();
      await first.text();

      expect(scratchEntries().length).toBe(1);
    });
  });

  describe("POST /save", () => {
    test("rewrites the scratch file of a running run so its watch runs the new code", async () => {
      const startRun = vi.fn((_input: RunInput) => endlessRun().handle);
      const handler = handlerWith(startRun);
      const started = await handler(post({ code: "old" }), context);

      const saved = await handler(
        save({ id: started.headers.get("x-run-id"), code: "new" }),
        context,
      );

      expect([saved.status, fs.readFileSync(startRun.mock.calls[0]![0].file, "utf8")]).toEqual([
        204,
        "new",
      ]);
    });

    test("rewrites the argument file so the watch runs again with the new argument", async () => {
      const startRun = vi.fn((_input: RunInput) => endlessRun().handle);
      const handler = handlerWith(startRun);
      const started = await handler(post({ code: "keep", arg: '{"a":1}' }), context);
      const id = started.headers.get("x-run-id");

      const saved = await handler(save({ id, arg: '{"a":2}' }), context);
      const { file, argFile } = startRun.mock.calls[0]![0];

      expect([
        saved.status,
        fs.readFileSync(argFile, "utf8"),
        fs.readFileSync(file, "utf8"),
      ]).toEqual([204, '{"a":2}', "keep"]);
    });

    test("saves a JSON5 argument as plain JSON", async () => {
      const startRun = vi.fn((_input: RunInput) => endlessRun().handle);
      const handler = handlerWith(startRun);
      const started = await handler(post({ code: "x" }), context);

      await handler(save({ id: started.headers.get("x-run-id"), arg: "{a: 2}" }), context);

      expect(fs.readFileSync(startRun.mock.calls[0]![0].argFile, "utf8")).toBe('{"a":2}');
    });

    test("writes {} when the argument is saved empty", async () => {
      const startRun = vi.fn((_input: RunInput) => endlessRun().handle);
      const handler = handlerWith(startRun);
      const started = await handler(post({ code: "x", arg: '{"a":1}' }), context);

      await handler(save({ id: started.headers.get("x-run-id"), arg: "" }), context);

      expect(fs.readFileSync(startRun.mock.calls[0]![0].argFile, "utf8")).toBe("{}");
    });

    describe("when the saved code formats to what the run already has", () => {
      async function startedRun(code: string) {
        const startRun = vi.fn((_input: RunInput) => endlessRun().handle);
        const handler = handlerWith(startRun, undefined, collapseSpaces);
        const started = await handler(post({ code }), context);
        const id = started.headers.get("x-run-id");
        const saveCode = (next: string) => handler(save({ id, code: next }), context);
        return { saveCode, file: () => fs.readFileSync(startRun.mock.calls[0]![0].file, "utf8") };
      }

      test("leaves the file alone, so the watch does not run again", async () => {
        const { saveCode, file } = await startedRun("const a = 1;");

        const saved = await saveCode("const   a =\n  1;");

        expect([saved.status, file()]).toEqual([204, "const a = 1;"]);
      });

      test("still writes a change that formats differently, and then compares against it", async () => {
        const { saveCode, file } = await startedRun("const a = 1;");

        await saveCode("const a = 2;");
        const afterChange = file();
        await saveCode("const  a  =  2;");

        expect([afterChange, file()]).toEqual(["const a = 2;", "const a = 2;"]);
      });

      test("writes code that cannot be formatted, such as one with a syntax error", async () => {
        const { saveCode, file } = await startedRun("const a = 1;");

        await saveCode("broken(");
        await saveCode("broken(");

        expect(file()).toBe("broken(");
      });

      test("writes the original text once the code formats differently again", async () => {
        const { saveCode, file } = await startedRun("const a = 1;");

        await saveCode("broken(");
        await saveCode("const a = 1;");

        expect(file()).toBe("const a = 1;");
      });
    });

    test("answers 404 for a run that is not running", async () => {
      const saved = await handlerWith(vi.fn())(save({ id: "nope", code: "x" }), context);

      expect(saved.status).toBe(404);
    });

    test.each([
      ["code that is not a string", { id: "i", code: 1 }],
      ["no id", { code: "x" }],
      ["neither code nor argument", { id: "i" }],
      ["an argument that is not valid JSON", { id: "i", arg: "{oops" }],
      ["an argument that is not a string", { id: "i", arg: 1 }],
    ])("rejects %s with 400", async (_name, body) => {
      const saved = await handlerWith(vi.fn())(save(body), context);

      expect(saved.status).toBe(400);
    });

    test("is 405 unless it is a POST", async () => {
      const response = await handlerWith(vi.fn())(new Request(`${root}/save`), context);

      expect([response.status, response.headers.get("allow")]).toEqual([405, "POST"]);
    });
  });
});
