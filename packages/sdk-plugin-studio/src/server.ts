import * as http from "node:http";
import { Readable, pipeline } from "node:stream";
import type { AddressInfo } from "node:net";

const HOST = "127.0.0.1";
const MAX_PORT_ATTEMPTS = 20;

type FetchHandler = (request: Request) => Response | Promise<Response>;

export interface StartServerOptions {
  createHandler: (port: number) => FetchHandler;
  port: number;
}

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

function listenOn(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function toRequest(req: http.IncomingMessage, signal: AbortSignal): Request {
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(new URL(req.url ?? "/", `http://${req.headers.host ?? HOST}`), {
    method: req.method,
    headers,
    signal,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" } : {}),
  });
}

async function respond(handler: FetchHandler, req: http.IncomingMessage, res: http.ServerResponse) {
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    const response = await handler(toRequest(req, abort.signal));
    const cookies = response.headers.getSetCookie();
    res.writeHead(response.status, {
      ...Object.fromEntries(response.headers),
      ...(cookies.length > 0 ? { "set-cookie": cookies } : {}),
    });
    res.flushHeaders();
    if (response.body === null) res.end();
    else if (req.method === "HEAD") {
      void response.body.cancel();
      res.end();
    } else pipeline(Readable.fromWeb(response.body as never), res, () => undefined);
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end("Internal Server Error\n");
  }
}

/**
 * Listen on 127.0.0.1, moving to the next port while the preferred one is in use.
 * @param options - Preferred port and the handler factory (it needs the final port)
 * @returns The running server
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const server = http.createServer();
    const port = options.port === 0 ? 0 : options.port + attempt;
    try {
      await listenOn(server, port);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      throw error;
    }
    const actual = (server.address() as AddressInfo).port;
    const handler = options.createHandler(actual);
    server.on("request", (req, res) => void respond(handler, req, res));
    return {
      port: actual,
      url: `http://${HOST}:${actual}/`,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
  }
  throw new Error(
    `No free port found from ${options.port} to ${options.port + MAX_PORT_ATTEMPTS - 1}.`,
  );
}
