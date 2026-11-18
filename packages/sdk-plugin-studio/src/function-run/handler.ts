import * as fs from "node:fs";
import * as path from "pathe";
import { renderPage } from "./page";
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
  arg: string | undefined;
}

export interface FunctionRunHandlerOptions {
  projectDir: string;
  startRun: (input: RunInput) => RunHandle;
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

function canonical(target: string): string | undefined {
  try {
    return path.resolve(fs.realpathSync(target));
  } catch {
    return undefined;
  }
}

function parseRunInput(body: unknown, projectDir: string): RunInput | string {
  if (typeof body !== "object" || body === null) return "Expected a JSON object.";
  const { file, arg } = body as { file?: unknown; arg?: unknown };
  if (typeof file !== "string" || file === "") return "`file` must be a non-empty string.";
  if (arg !== undefined && typeof arg !== "string") return "`arg` must be a string.";
  if (arg !== undefined && arg !== "" && !isValidJson(arg)) return "`arg` must be valid JSON.";

  const root = canonical(projectDir);
  const target = root === undefined ? undefined : canonical(path.resolve(root, file));
  if (root === undefined || target === undefined) return "`file` was not found in the project.";
  const relative = path.relative(root, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
  ) {
    return "`file` must be inside the project.";
  }
  return { file: target, arg: arg === "" ? undefined : arg };
}

function streamRun(handle: RunHandle, signal: AbortSignal, onEnd: () => void): Response {
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
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
}

/**
 * Create the handler of the Function run tab: it serves the page and streams a
 * `function run --watch` process to the browser as server-sent events.
 * @param options - Project directory and the function that starts a run
 * @returns A Web-standard request handler for the shell
 */
export function createFunctionRunHandler(options: FunctionRunHandlerOptions): UiHandler {
  const watching = new Set<string>();

  return async (request, { token }) => {
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();

    if (pathname === "/") {
      if (method !== "GET" && method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      }
      return new Response(method === "HEAD" ? null : renderPage(token), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (pathname !== "/run") return new Response("Not Found", { status: 404 });
    if (method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Expected a JSON body.");
    }
    const input = parseRunInput(body, options.projectDir);
    if (typeof input === "string") return badRequest(input);

    if (watching.has(input.file)) {
      return new Response("That file is already being watched.\n", { status: 409 });
    }
    watching.add(input.file);

    let handle: RunHandle;
    try {
      handle = options.startRun(input);
    } catch (error) {
      watching.delete(input.file);
      return new Response(`${error instanceof Error ? error.message : String(error)}\n`, {
        status: 500,
      });
    }
    return streamRun(handle, request.signal, () => watching.delete(input.file));
  };
}
