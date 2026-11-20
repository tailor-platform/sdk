import * as net from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { startServer, type RunningServer } from "./server";

const running: RunningServer[] = [];
const occupied: net.Server[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()));
  await Promise.all(occupied.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start(
  createHandler: (port: number) => (request: Request) => Promise<Response> | Response,
  port = 0,
) {
  const server = await startServer({ createHandler, port });
  running.push(server);
  return server;
}

function occupy(port = 0): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(port, "127.0.0.1", () => {
      occupied.push(server);
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

describe("startServer", () => {
  test("hands the handler the port it actually listens on", async () => {
    let seen = 0;
    const server = await start((port) => {
      seen = port;
      return () => new Response("ok");
    });
    expect(seen).toBe(server.port);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
  });

  test("moves to the next port when the preferred one is in use", async () => {
    const busy = await occupy();
    const server = await start(() => () => new Response("ok"), busy);
    expect(server.port).toBeGreaterThan(busy);
  });

  test("passes method, path, headers and body to the handler and returns its response", async () => {
    const server = await start(() => async (request) => {
      const body = await request.text();
      return new Response(`${request.method} ${new URL(request.url).pathname} ${body}`, {
        status: 201,
        headers: { "x-seen": request.headers.get("x-in") ?? "" },
      });
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/a/b`, {
      method: "POST",
      headers: { "x-in": "hello" },
      body: "payload",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-seen")).toBe("hello");
    expect(await res.text()).toBe("POST /a/b payload");
  });

  test("sends each Set-Cookie header the handler returns", async () => {
    const server = await start(() => () => {
      const headers = new Headers();
      headers.append("set-cookie", "a=1");
      headers.append("set-cookie", "b=2");
      return new Response("ok", { headers });
    });
    const res = await fetch(server.url);
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  test("delivers a streamed chunk before the response ends", async () => {
    const server = await start(() => () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: 1\n\n"));
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 1\n\n");
    await reader.cancel();
  });

  test("aborts the request signal when the client disconnects", async () => {
    let aborted!: () => void;
    const abortSeen = new Promise<void>((resolve) => (aborted = resolve));
    const server = await start(() => (request) => {
      request.signal.addEventListener("abort", () => aborted());
      return new Response(new ReadableStream<Uint8Array>({ start() {} }));
    });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${server.port}/`, { signal: controller.signal });
    expect(res.status).toBe(200);
    controller.abort();
    await abortSeen;
  });

  test("answers 500 and keeps serving when the handler rejects", async () => {
    let calls = 0;
    const server = await start(() => () => {
      if (calls++ === 0) return Promise.reject(new Error("boom"));
      return new Response("ok");
    });
    expect((await fetch(`http://127.0.0.1:${server.port}/`)).status).toBe(500);
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("ok");
  });

  test("keeps serving when a streamed body errors after the first chunk", async () => {
    let calls = 0;
    const server = await start(() => () => {
      if (calls++ > 0) return new Response("ok");
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: 1\n\n"));
          setTimeout(() => controller.error(new Error("boom")), 10);
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    });
    const first = await fetch(`http://127.0.0.1:${server.port}/`);
    await first.text().catch(() => undefined);
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("ok");
  });

  test("cancels the response stream when the client disconnects", async () => {
    let cancelled!: () => void;
    const cancelSeen = new Promise<void>((resolve) => (cancelled = resolve));
    const server = await start(() => () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: 1\n\n"));
        },
        cancel: () => cancelled(),
      });
      return new Response(stream);
    });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${server.port}/`, { signal: controller.signal });
    await res.body!.getReader().read();
    controller.abort();
    await expect(cancelSeen).resolves.toBeUndefined();
  });
});
