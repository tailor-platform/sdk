import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { selectionArgs } from "../workspace-context";
import { injectToken } from "./page";
import type { UiHandler } from "../shell-handler";

export type RunEvent =
  | { type: "stdout" | "stderr"; line: string }
  | { type: "exit"; code: number | null };

export interface RunHandle {
  events: AsyncIterable<RunEvent>;
  stop: () => void;
}

export interface RunInput {
  file: string;
  argFile: string;
  workspaceArgs: string[];
}

export interface FunctionRunHandlerOptions {
  projectDir: string;
  scratchRoot?: string;
  startRun: (input: RunInput) => RunHandle;
  loadPage: () => Promise<string>;
  /** Formats code for comparison; resolves to undefined when it cannot be formatted. */
  formatCode?: (code: string) => Promise<string | undefined>;
}

const encoder = new TextEncoder();

function badRequest(message: string): Response {
  return new Response(`${message}\n`, { status: 400 });
}

function sseFrame(event: RunEvent): Uint8Array {
  const data = event.type === "exit" ? JSON.stringify({ code: event.code }) : event.line;
  return encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`);
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const EMPTY_ARG = "{}";

function parseArg(arg: unknown): string | undefined | null {
  if (arg === undefined) return undefined;
  if (typeof arg !== "string") return null;
  if (arg === "") return EMPTY_ARG;
  return isValidJson(arg) ? arg : null;
}

function parseRunBody(body: unknown): { code: string; arg: string } | string {
  if (typeof body !== "object" || body === null) return "Expected a JSON object.";
  const { code, arg } = body as { code?: unknown; arg?: unknown };
  if (typeof code !== "string") return "`code` must be a string.";
  const parsed = parseArg(arg);
  if (parsed === null) return "`arg` must be a string of valid JSON.";
  return { code, arg: parsed ?? EMPTY_ARG };
}

function parseSaveBody(body: unknown): { id: string; code?: string; arg?: string } | string {
  if (typeof body !== "object" || body === null) return "Expected a JSON object.";
  const { id, code, arg } = body as { id?: unknown; code?: unknown; arg?: unknown };
  if (typeof id !== "string" || id === "") return "`id` must be a non-empty string.";
  if (code !== undefined && typeof code !== "string") return "`code` must be a string.";
  const parsed = parseArg(arg);
  if (parsed === null) return "`arg` must be a string of valid JSON.";
  if (code === undefined && parsed === undefined) return "Send `code` or `arg`.";
  return {
    id,
    ...(code === undefined ? {} : { code }),
    ...(parsed === undefined ? {} : { arg: parsed }),
  };
}

interface ScratchEntry {
  file: string;
  argFile: string;
  formatted: string | undefined;
  queue: Promise<void>;
}

function createScratch(
  projectDir: string,
  root: string,
  formatCode: (code: string) => Promise<string | undefined>,
) {
  const files = new Map<string, ScratchEntry>();
  let directory: string | undefined;

  return {
    async create(
      code: string,
      arg: string,
    ): Promise<{ id: string; file: string; argFile: string }> {
      const formatted = await formatCode(code);
      if (directory === undefined) {
        directory = fs.mkdtempSync(path.join(root, "tailor-studio-run-"));
        const modules = path.join(projectDir, "node_modules");
        if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(directory, "node_modules"));
      }
      const id = randomUUID();
      const file = path.join(directory, `${id}.ts`);
      const argFile = path.join(directory, `${id}.json`);
      fs.writeFileSync(file, code);
      fs.writeFileSync(argFile, arg);
      files.set(id, { file, argFile, formatted, queue: Promise.resolve() });
      return { id, file, argFile };
    },
    async write(id: string, change: { code?: string; arg?: string }): Promise<boolean> {
      const entry = files.get(id);
      if (entry === undefined) return false;
      const task = entry.queue.then(async () => {
        if (change.code !== undefined) {
          const formatted = await formatCode(change.code);
          const unchanged = formatted !== undefined && formatted === entry.formatted;
          entry.formatted = formatted;
          if (!unchanged && files.has(id)) fs.writeFileSync(entry.file, change.code);
        }
        if (change.arg !== undefined && files.has(id)) fs.writeFileSync(entry.argFile, change.arg);
      });
      entry.queue = task.catch(() => undefined);
      await task;
      return true;
    },
    release(id: string): void {
      files.delete(id);
      if (files.size === 0 && directory !== undefined) {
        fs.rmSync(directory, { recursive: true, force: true });
        directory = undefined;
      }
    },
  };
}

function streamRun(
  handle: RunHandle,
  signal: AbortSignal,
  onEnd: () => void,
  headers: Record<string, string>,
): Response {
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    handle.stop();
  };
  signal.addEventListener("abort", stop, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of handle.events) {
          if (stopped) break;
          controller.enqueue(sseFrame(event));
        }
      } finally {
        onEnd();
        try {
          controller.close();
        } catch {
          // already closed by cancel
        }
      }
    },
    cancel: stop,
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", ...headers },
  });
}

/**
 * Create the handler of the Function run tab: it serves the page and streams a
 * `function run --watch` process on code typed in the page to the browser as
 * server-sent events.
 * @param options - Project directory and the function that starts a run
 * @returns A Web-standard request handler for the shell
 */
export function createFunctionRunHandler(options: FunctionRunHandlerOptions): UiHandler {
  const scratch = createScratch(
    options.projectDir,
    options.scratchRoot ?? os.tmpdir(),
    options.formatCode ?? (async (code) => code),
  );

  return async (request, { token, getSelection }) => {
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();

    if (pathname === "/") {
      if (method !== "GET" && method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      }
      let page: string;
      try {
        page = injectToken(await options.loadPage(), token);
      } catch (error) {
        return new Response(`${error instanceof Error ? error.message : String(error)}\n`, {
          status: 500,
        });
      }
      return new Response(method === "HEAD" ? null : page, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (pathname !== "/run" && pathname !== "/save") {
      return new Response("Not Found", { status: 404 });
    }
    if (method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Expected a JSON body.");
    }

    if (pathname === "/save") {
      const input = parseSaveBody(body);
      if (typeof input === "string") return badRequest(input);
      return (await scratch.write(input.id, input))
        ? new Response(null, { status: 204 })
        : new Response("No such run.\n", { status: 404 });
    }

    const input = parseRunBody(body);
    if (typeof input === "string") return badRequest(input);

    const workspaceArgs = selectionArgs(getSelection());
    if (workspaceArgs.length === 0) {
      return new Response("Select a workspace in the bar at the top of the page.\n", {
        status: 409,
      });
    }

    const { id, file, argFile } = await scratch.create(input.code, input.arg);
    let handle: RunHandle;
    try {
      handle = options.startRun({ file, argFile, workspaceArgs });
    } catch (error) {
      scratch.release(id);
      return new Response(`${error instanceof Error ? error.message : String(error)}\n`, {
        status: 500,
      });
    }
    return streamRun(handle, request.signal, () => scratch.release(id), { "x-run-id": id });
  };
}
