import * as net from "node:net";
import { Code, createClient } from "@connectrpc/connect";
import { OperatorService } from "@tailor-platform/tailor-proto/service_pb";
import { describe, expect, test } from "vitest";
import { createTransport, errorHandlingInterceptor, retryInterceptor } from "./client";

describe("retryInterceptor against a real connection", () => {
  test("retries CreateWorkspace when the server closes the connection before the TLS handshake", async () => {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected an AddressInfo from a TCP listener");
    }
    try {
      const transport = await createTransport(`https://127.0.0.1:${address.port}`, [
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
});
