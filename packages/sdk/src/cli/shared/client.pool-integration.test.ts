import * as http2 from "node:http2";
import { create } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { OperatorService } from "@tailor-platform/tailor-proto/service_pb";
import {
  UploadFileRequest_InitialUploadMetadataSchema,
  UploadFileRequestSchema,
  UploadFileResponseSchema,
  type UploadFileRequest,
} from "@tailor-platform/tailor-proto/staticwebsite_pb";
import { describe, expect, test, vi } from "vitest";
import { createPooledStreamTransport, createTransport } from "./client";

/**
 * These tests exercise `createPooledStreamTransport` against a real local
 * HTTP/2 server (not a mocked `Transport`), asserting the pool's topology
 * invariants directly at the HTTP/2 framing level: how many sessions
 * (connections) it opens, and how many streams are ever concurrently active
 * on any one of them.
 */
describe("createPooledStreamTransport against a real HTTP/2 server", () => {
  type SessionStats = { active: number; maxActive: number };

  /**
   * Starts a plaintext (h2c) server implementing only `OperatorService`'s
   * `uploadFile`. Each request is drained immediately (the client always
   * sends its full body right away); the handler then withholds its
   * response until the test calls `release(filePath)`, keyed off the
   * request's `filePath`. This — rather than pausing the client's request
   * body — is what keeps a connection "busy" for a controllable duration:
   * the pool only releases a connection once the (single) response message
   * has been read, so delaying the server's response delays the release.
   * Session/stream counts come from the raw Node http2 events, independent
   * of connect's own request handling.
   * @returns The server's base URL, session/stream inspection helpers, and `release`
   */
  async function startServer() {
    const sessionStats = new Map<http2.Http2Session, SessionStats>();
    // `release(filePath)` can race the handler's own registration of its
    // gate — the caller may release an upload before its (queued) request
    // has even reached the server. `preReleased` makes that race harmless:
    // a release that arrives early is remembered and consumed immediately
    // once the handler asks to wait.
    const pendingReleases = new Map<string, () => void>();
    const preReleased = new Set<string>();

    function waitForRelease(filePath: string): Promise<void> {
      if (preReleased.delete(filePath)) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        pendingReleases.set(filePath, resolve);
      });
    }

    function release(filePath: string): void {
      const resolve = pendingReleases.get(filePath);
      if (resolve) {
        pendingReleases.delete(filePath);
        resolve();
      } else {
        preReleased.add(filePath);
      }
    }

    const server = http2.createServer(
      connectNodeAdapter({
        routes: (router) =>
          router.service(OperatorService, {
            async uploadFile(requests: AsyncIterable<UploadFileRequest>) {
              let filePath: string | undefined;
              for await (const request of requests) {
                if (request.payload.case === "initialMetadata") {
                  filePath = request.payload.value.filePath;
                }
              }
              if (filePath !== undefined) {
                await waitForRelease(filePath);
              }
              return create(UploadFileResponseSchema, {});
            },
          }),
      }),
    );

    server.on("session", (session) => {
      sessionStats.set(session, { active: 0, maxActive: 0 });
    });
    server.on("stream", (stream) => {
      if (!stream.session) return;
      const stats = sessionStats.get(stream.session);
      if (!stats) return;
      stats.active++;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      stream.on("close", () => {
        stats.active--;
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected an AddressInfo from a TCP listener");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    return {
      baseUrl,
      sessionCount: () => sessionStats.size,
      maxActivePerSession: () => Math.max(0, ...[...sessionStats.values()].map((s) => s.maxActive)),
      totalActive: () => [...sessionStats.values()].reduce((sum, s) => sum + s.active, 0),
      release,
      // `server.close()` alone only stops accepting new connections and
      // waits for existing ones to end on their own; the client's h2
      // sessions stay open (idle, keep-alive) well past the test, so that
      // wait would hang. Destroy every tracked session directly instead.
      close: () =>
        new Promise<void>((resolve) => {
          for (const session of sessionStats.keys()) {
            session.destroy();
          }
          server.close(() => resolve());
        }),
    };
  }

  // A client-streaming request that sends its full body immediately,
  // identified by `filePath` so the test can tell the server which upload's
  // response to release.
  function makeUpload(filePath: string): AsyncIterable<UploadFileRequest> {
    async function* requests(): AsyncGenerator<UploadFileRequest> {
      yield create(UploadFileRequestSchema, {
        payload: {
          case: "initialMetadata",
          value: create(UploadFileRequest_InitialUploadMetadataSchema, {
            workspaceId: "w",
            deploymentId: "d",
            filePath,
          }),
        },
      });
      yield create(UploadFileRequestSchema, {
        payload: { case: "chunkData", value: new Uint8Array([1, 2, 3]) },
      });
    }
    return requests();
  }

  test("cancels a queued upload before a connection is available and lets the next upload proceed", async () => {
    const server = await startServer();
    const primary = await createTransport(server.baseUrl, []);
    const client = createClient(
      OperatorService,
      createPooledStreamTransport(primary, () => createTransport(server.baseUrl, []), 1),
    );
    const controller = new AbortController();
    const first = client.uploadFile(makeUpload("first.txt"));
    let canceledError: unknown;
    const canceled = client
      .uploadFile(makeUpload("canceled.txt"), { signal: controller.signal })
      .catch((error: unknown) => {
        canceledError = error;
      });
    const next = client.uploadFile(makeUpload("next.txt"));
    try {
      await vi.waitFor(() => expect(server.totalActive()).toBe(1));
      controller.abort();
      await vi.waitFor(() => expect(canceledError).toMatchObject({ code: Code.Canceled }));
      expect(server.sessionCount()).toBe(1);
      server.release("first.txt");
      server.release("next.txt");
      await Promise.all([first, canceled, next]);
      expect(server.maxActivePerSession()).toBe(1);
    } finally {
      server.release("first.txt");
      server.release("canceled.txt");
      server.release("next.txt");
      await Promise.allSettled([first, canceled, next]);
      await server.close();
    }
  });

  test("caps sessions at maxConnections, never runs 2 uploads concurrently on one session, and reuses a freed session instead of opening a new one", async () => {
    const server = await startServer();
    try {
      const maxConnections = 2;
      const primary = await createTransport(server.baseUrl, []);
      const pooled = createPooledStreamTransport(
        primary,
        () => createTransport(server.baseUrl, []),
        maxConnections,
      );
      const client = createClient(OperatorService, pooled);

      const call1 = client.uploadFile(makeUpload("a.txt"));
      const call2 = client.uploadFile(makeUpload("b.txt"));
      let call3Settled = false;
      const call3 = client.uploadFile(makeUpload("c.txt")).then((r) => {
        call3Settled = true;
        return r;
      });

      // The first two uploads reach the server on two separate sessions,
      // each with exactly one active stream; the third is queued
      // client-side and never opens an HTTP/2 stream at all.
      await vi.waitFor(() => expect(server.totalActive()).toBe(2));
      expect(server.sessionCount()).toBe(maxConnections);
      expect(server.maxActivePerSession()).toBe(1);
      expect(call3Settled).toBe(false);

      // Releasing one upload's response lets the queued third one
      // proceed, reusing the now-idle connection rather than opening a
      // third session.
      server.release("a.txt");
      await call1;
      await vi.waitFor(() => expect(server.totalActive()).toBe(2));
      expect(server.sessionCount()).toBe(maxConnections);
      expect(server.maxActivePerSession()).toBe(1);

      server.release("b.txt");
      server.release("c.txt");
      await call2;
      await call3;
      expect(call3Settled).toBe(true);

      // No session was ever asked to run more than one upload stream at once.
      expect(server.maxActivePerSession()).toBe(1);
      expect(server.sessionCount()).toBe(maxConnections);
    } finally {
      await server.close();
    }
  }, 10_000);
});
