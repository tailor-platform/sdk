import { isBuiltin } from "node:module";
import { NODE_ONLY_GLOBALS } from "#/utils/es-builtins";

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

export function isNodeBuiltinImport(specifier: string): boolean {
  return isBuiltin(specifier);
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

// Friendly suggestions for the most common members of NODE_ONLY_GLOBALS. A
// name in NODE_ONLY_GLOBALS without an entry here still gets flagged, just
// with the generic message below instead of a targeted one.
const GLOBAL_SUGGESTIONS: Record<string, string> = {
  process:
    "Use `defineConfig({ env })` and the `env` argument passed into the body function instead.",
  Buffer: "Use Uint8Array or ArrayBuffer instead.",
  global: "Use globalThis instead.",
  __dirname: "File system paths are not available in the Tailor Platform runtime.",
  __filename: "File system paths are not available in the Tailor Platform runtime.",
  require: "Use a static `import` instead.",
  module: "CommonJS module semantics are not available in the Tailor Platform runtime.",
  exports: "CommonJS module semantics are not available in the Tailor Platform runtime.",
  setImmediate: "Use setTimeout instead.",
  clearImmediate: "Use clearTimeout instead.",
};

export function isForbiddenGlobal(name: string): boolean {
  return NODE_ONLY_GLOBALS.has(name);
}

export function getForbiddenGlobalMessage(name: string): string {
  const suggestion = Object.hasOwn(GLOBAL_SUGGESTIONS, name) ? GLOBAL_SUGGESTIONS[name] : undefined;
  const base = `"${name}" is not available in the Tailor Platform runtime.`;
  return suggestion ? `${base} ${suggestion}` : base;
}
