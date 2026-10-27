import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { serveJsonRpc } from "./rpc";

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

function parseFrames(output: Buffer): unknown[] {
  const messages: unknown[] = [];
  let rest = output;
  while (rest.length > 0) {
    const end = rest.indexOf("\r\n\r\n");
    const length = Number(/Content-Length: (\d+)/.exec(rest.subarray(0, end).toString())![1]);
    messages.push(JSON.parse(rest.subarray(end + 4, end + 4 + length).toString()));
    rest = rest.subarray(end + 4 + length);
  }
  return messages;
}

async function exchange(
  chunks: Buffer[],
  handlers: Parameters<typeof serveJsonRpc>[0],
): Promise<unknown[]> {
  const input = new PassThrough();
  const written: Buffer[] = [];
  const done = serveJsonRpc(handlers, input, (chunk) => written.push(Buffer.from(chunk)));
  for (const chunk of chunks) input.write(chunk);
  input.end();
  await done;
  return parseFrames(Buffer.concat(written));
}

describe("serveJsonRpc", () => {
  test("answers requests split across chunks and packed into one", async () => {
    const bytes = Buffer.concat([
      frame({ jsonrpc: "2.0", id: 1, method: "echo", params: { text: "日本語" } }),
      frame({ jsonrpc: "2.0", id: 2, method: "echo", params: { text: "b" } }),
    ]);

    const responses = await exchange(
      [bytes.subarray(0, 7), bytes.subarray(7, 40), bytes.subarray(40)],
      {
        echo: (params) => params,
      },
    );

    expect(responses).toEqual([
      { jsonrpc: "2.0", id: 1, result: { text: "日本語" } },
      { jsonrpc: "2.0", id: 2, result: { text: "b" } },
    ]);
  });

  test("answers requests in the order they arrive, one at a time", async () => {
    const order: string[] = [];
    const responses = await exchange(
      [
        frame({ jsonrpc: "2.0", id: 1, method: "slow" }),
        frame({ jsonrpc: "2.0", id: 2, method: "fast" }),
      ],
      {
        slow: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push("slow");
          return {};
        },
        fast: () => {
          order.push("fast");
          return {};
        },
      },
    );

    expect(order).toEqual(["slow", "fast"]);
    expect(responses.map((response) => (response as { id: number }).id)).toEqual([1, 2]);
  });

  test("reports an unknown method and a failing handler as errors", async () => {
    const responses = await exchange(
      [
        frame({ jsonrpc: "2.0", id: 1, method: "nope" }),
        frame({ jsonrpc: "2.0", id: 2, method: "fail" }),
      ],
      {
        fail: () => {
          throw new Error("boom");
        },
      },
    );

    expect(responses).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Unknown method: nope" } },
      { jsonrpc: "2.0", id: 2, error: { code: -32603, message: "boom" } },
    ]);
  });

  test("does not answer notifications", async () => {
    let called = false;
    const responses = await exchange([frame({ jsonrpc: "2.0", method: "note" })], {
      note: () => {
        called = true;
      },
    });

    expect(called).toBe(true);
    expect(responses).toEqual([]);
  });
});
