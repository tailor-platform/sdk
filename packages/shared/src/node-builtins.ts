import { isBuiltin } from "node:module";

/**
 * Node-only ambient globals that the Tailor Platform runtime never defines.
 * The SDK derives the same set from the `globals` package at runtime and pins
 * it to this list in its tests, so the lint plugin can ship the names without
 * depending on `globals`.
 */
export const NODE_ONLY_GLOBAL_NAMES: readonly string[] = [
  "__dirname",
  "__filename",
  "Buffer",
  "clearImmediate",
  "exports",
  "global",
  "module",
  "process",
  "require",
  "setImmediate",
];

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

// Friendly suggestions for the most common members of NODE_ONLY_GLOBAL_NAMES.
// A name without an entry here still gets flagged, just with the generic
// message below instead of a targeted one.
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

export function describeUnavailable(name: string): string {
  return `"${name}" is not available in the Tailor Platform runtime.`;
}

function withSuggestion(name: string, suggestion: string | undefined): string {
  const base = describeUnavailable(name);
  return suggestion ? `${base} ${suggestion}` : base;
}

export function isNodeBuiltinImport(specifier: string): boolean {
  return isBuiltin(specifier);
}

export function getNodeBuiltinMessage(specifier: string): string {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return withSuggestion(specifier, SUGGESTIONS[bare]);
}

export function getForbiddenGlobalMessage(name: string): string {
  return withSuggestion(
    name,
    Object.hasOwn(GLOBAL_SUGGESTIONS, name) ? GLOBAL_SUGGESTIONS[name] : undefined,
  );
}
