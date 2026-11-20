import { normalizeArg } from "./arg";
import { injectToken } from "./page";
import type { UiHandler } from "../shell-handler";
import type { createSyncedFiles } from "./files";
import type { createRunSession } from "./session";

export interface FunctionRunHandlerOptions {
  loadPage: () => Promise<string>;
  files: ReturnType<typeof createSyncedFiles>;
  session: ReturnType<typeof createRunSession>;
  /** Where the files are: relative to the project for showing, absolute for copying. */
  paths: FunctionRunPaths;
}

interface FilePaths {
  file: string;
  argFile: string;
  resultFile?: string;
}

export type FunctionRunPaths = FilePaths & { absolute?: FilePaths };

export type FunctionRunHandler = UiHandler & { close: () => void };

const TOKEN_HEADER = "x-tailor-studio-token";
const encoder = new TextEncoder();

function badRequest(message: string): Response {
  return new Response(`${message}\n`, { status: 400 });
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { allow } });
}

function frame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseFileBody(body: unknown): { code?: string; arg?: string } | string {
  if (typeof body !== "object" || body === null) return "Expected a JSON object.";
  const { code, arg } = body as { code?: unknown; arg?: unknown };
  if (code !== undefined && typeof code !== "string") return "`code` must be a string.";
  if (arg !== undefined && typeof arg !== "string") return "`arg` must be a string.";
  if (arg !== undefined && normalizeArg(arg) === undefined) {
    return "`arg` must be valid JSON or JSON5.";
  }
  if (code === undefined && arg === undefined) return "Send `code` or `arg`.";
  return {
    ...(code === undefined ? {} : { code }),
    ...(arg === undefined ? {} : { arg }),
  };
}

/**
 * Create the handler of the Function run tab. It serves the page, streams the state of the
 * files and of the watch to it, and takes edits, start and stop from it.
 * @param options - The page, the files, the watch and where the files are
 * @returns A Web-standard request handler for the shell, with a `close` for shutdown
 */
export function createFunctionRunHandler(options: FunctionRunHandlerOptions): FunctionRunHandler {
  const { files, session, paths } = options;

  function events(signal: AbortSignal): Response {
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(frame(event, data));
          } catch {
            // the page is gone
          }
        };
        const { status, running, reason, entries } = session.snapshot();
        const { code, arg } = files.read();
        const { argError } = files.status();
        send("state", { ...paths, code, arg, status, running, reason, argError });
        for (const entry of entries) send("entry", entry);

        const stopSession = session.subscribe((event) => {
          if (event.type === "reset") send("reset", {});
          else if (event.type === "status") {
            send("status", { status: event.status, running: event.running, reason: event.reason });
          } else send("entry", event.entry);
        });
        const stopFiles = files.subscribe((change) => send("file", change));
        cleanup = () => {
          stopSession();
          stopFiles();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        signal.addEventListener("abort", cleanup, { once: true });
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
    });
  }

  const handler: UiHandler = async (request, { token }) => {
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();

    if (pathname === "/") {
      if (method !== "GET" && method !== "HEAD") return methodNotAllowed("GET, HEAD");
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

    if (pathname === "/events") {
      if (method !== "GET") return methodNotAllowed("GET");
      if (request.headers.get(TOKEN_HEADER) !== token) {
        return new Response("Forbidden: missing or invalid token\n", { status: 403 });
      }
      return events(request.signal);
    }

    if (pathname === "/file") {
      if (method !== "PUT") return methodNotAllowed("PUT");
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return badRequest("Expected a JSON body.");
      }
      const change = parseFileBody(body);
      if (typeof change === "string") return badRequest(change);
      await files.write(change);
      return new Response(null, { status: 204 });
    }

    if (pathname === "/start" || pathname === "/stop") {
      if (method !== "POST") return methodNotAllowed("POST");
      if (pathname === "/stop") {
        session.stop();
        return new Response(null, { status: 204 });
      }
      const result = session.start();
      return result.ok
        ? new Response(null, { status: 204 })
        : new Response(`${result.reason}\n`, { status: 409 });
    }

    return new Response("Not Found", { status: 404 });
  };

  return Object.assign(handler, {
    close: () => {
      session.close();
      files.close();
    },
  });
}
