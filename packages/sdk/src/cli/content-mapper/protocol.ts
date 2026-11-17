import type { JsonRpcHandler } from "./rpc";

/** The methods of the content mapper protocol a mapper handles. */
export type ContentMapperHandlers = Record<
  "initialize" | "openProject" | "transform" | "closeProject",
  JsonRpcHandler
>;

export type PositionEncoding = "utf-8" | "utf-16";

interface InitializeParams {
  positionEncodings?: PositionEncoding[];
  protocolVersion?: number;
}

interface InitializeResult {
  protocolVersion?: number;
  positionEncoding: PositionEncoding;
  diagnosticSource: string;
}

/**
 * Answer the content mapper protocol's `initialize` request. It reads no
 * project, so a caller can answer it before loading anything heavy.
 * @param params - The request's parameters
 * @returns The negotiated position encoding and the protocol version to echo
 */
export function initializeResult(params: unknown): InitializeResult {
  const { positionEncodings, protocolVersion } = (params ?? {}) as InitializeParams;
  return {
    ...(protocolVersion !== undefined && { protocolVersion }),
    positionEncoding:
      positionEncodings && !positionEncodings.includes("utf-16") ? "utf-8" : "utf-16",
    diagnosticSource: "tailor",
  };
}
