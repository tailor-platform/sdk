import * as net from "node:net";
import { Code, createClient, type Interceptor } from "@connectrpc/connect";
import { OperatorService } from "@tailor-platform/tailor-proto/service_pb";
import { describe, expect, test } from "vitest";
import { createTransport, errorHandlingInterceptor, retryInterceptor } from "./client";

/**
 * Start a TCP listener on a free local port.
 * @param server - Server to start
 * @returns The port the server listens on
 */
async function listenOnFreePort(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected an AddressInfo from a TCP listener");
  }
  return address.port;
}

describe("retryInterceptor against a real connection", () => {
  test("retries CreateWorkspace when the server closes the connection before the TLS handshake", async () => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.end();
    });
    const port = await listenOnFreePort(server);
    try {
      const transport = await createTransport(`https://127.0.0.1:${port}`, [
        retryInterceptor(),
        errorHandlingInterceptor(),
      ]);

      await expect(
        createClient(OperatorService, transport).createWorkspace({ workspaceName: "ws" }),
      ).rejects.toMatchObject({ code: Code.Aborted });
      expect(sockets.size).toBe(3);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("retries ExecScript when the connection is refused", async () => {
    const server = net.createServer();
    const port = await listenOnFreePort(server);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    let attempts = 0;
    const countAttempts: Interceptor = (next) => async (req) => {
      attempts++;
      return await next(req);
    };

    const transport = await createTransport(`https://127.0.0.1:${port}`, [
      retryInterceptor(),
      errorHandlingInterceptor(),
      countAttempts,
    ]);

    await expect(
      createClient(OperatorService, transport).execScript({ workspaceId: "ws", code: "" }),
    ).rejects.toMatchObject({ code: Code.Unavailable });
    expect(attempts).toBe(3);
  });
});
