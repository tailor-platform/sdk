import { errorSummary } from "#/cli/shared/errors";
import type { Readable } from "node:stream";

/** Handles one JSON-RPC method; the resolved value is the result. */
export type JsonRpcHandler = (params: unknown) => unknown;

interface JsonRpcMessage {
  id?: number | string;
  method: string;
  params?: unknown;
}

const HEADER_END = "\r\n\r\n";

/**
 * Serve JSON-RPC over `Content-Length`-framed messages, as TypeScript talks to
 * a content mapper. Requests are handled one at a time, in arrival order.
 * @param handlers - Handler for each method
 * @param input - Stream the requests arrive on
 * @param write - Writes a framed response
 * @returns Resolves once the input ends and every request has been answered
 */
export async function serveJsonRpc(
  handlers: Readonly<Record<string, JsonRpcHandler>>,
  input: Readable,
  write: (chunk: Buffer) => void,
): Promise<void> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    for (;;) {
      const headerEnd = buffer.indexOf(HEADER_END);
      if (headerEnd < 0) break;
      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const length = /Content-Length:\s*(\d+)/i.exec(header)?.[1];
      if (length === undefined) throw new Error(`Malformed JSON-RPC header: ${header}`);
      const bodyStart = headerEnd + HEADER_END.length;
      const bodyEnd = bodyStart + Number(length);
      if (buffer.length < bodyEnd) break;
      const message = JSON.parse(
        buffer.subarray(bodyStart, bodyEnd).toString("utf8"),
      ) as JsonRpcMessage;
      buffer = buffer.subarray(bodyEnd);
      const response = await dispatch(handlers, message);
      if (message.id === undefined) continue;
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, ...response }));
      write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}${HEADER_END}`), body]));
    }
  }
}

async function dispatch(
  handlers: Readonly<Record<string, JsonRpcHandler>>,
  message: JsonRpcMessage,
): Promise<{ result: unknown } | { error: { code: number; message: string } }> {
  const handler = Object.hasOwn(handlers, message.method) ? handlers[message.method] : undefined;
  if (!handler) return { error: { code: -32601, message: `Unknown method: ${message.method}` } };
  try {
    return { result: (await handler(message.params)) ?? {} };
  } catch (error) {
    return { error: { code: -32603, message: errorSummary(error) } };
  }
}
