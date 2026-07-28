import { builtinModules } from "node:module";

const SUGGESTIONS: Record<string, string> = {
  crypto: "Use the Web Crypto API (globalThis.crypto) instead.",
  buffer: "Use Uint8Array or ArrayBuffer instead.",
  fs: "File system access is not available in the Tailor Platform runtime.",
  "fs/promises": "File system access is not available in the Tailor Platform runtime.",
  path: "Use URL or URLPattern for path manipulation.",
  http: "Use the Fetch API (globalThis.fetch) for HTTP requests instead.",
  https: "Use the Fetch API (globalThis.fetch) for HTTPS requests instead.",
  url: "Use the URL and URLSearchParams Web APIs instead.",
  util: "Use Web Standard APIs instead.",
  stream: "Use Web Streams API (ReadableStream, WritableStream, TransformStream) instead.",
  "stream/web": "Use Web Streams API (ReadableStream, WritableStream, TransformStream) instead.",
  events: "Use EventTarget instead.",
  zlib: "Use CompressionStream and DecompressionStream Web APIs instead.",
  querystring: "Use URLSearchParams instead.",
  string_decoder: "Use TextDecoder instead.",
};

const NODE_BUILTINS = new Set(builtinModules.map(normalizeNodeBuiltinSpecifier));

export function isNodeBuiltinImport(specifier: string): boolean {
  const bare = normalizeNodeBuiltinSpecifier(specifier);
  return NODE_BUILTINS.has(bare);
}

export function getNodeBuiltinMessage(specifier: string): string {
  const bare = normalizeNodeBuiltinSpecifier(specifier);
  const suggestion = SUGGESTIONS[bare];
  const base = `"${specifier}" is not available in the Tailor Platform runtime.`;
  return suggestion ? `${base} ${suggestion}` : base;
}

function normalizeNodeBuiltinSpecifier(specifier: string): string {
  return specifier.startsWith("node:") ? specifier.slice(5) : specifier;
}
