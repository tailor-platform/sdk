/**
 * Blocked Node.js built-in modules and their Web Standard API alternatives.
 *
 * The Tailor Platform runtime only provides Web Standard APIs.
 * These Node.js modules are not available and should be replaced with
 * the suggested alternatives.
 */

const SUGGESTIONS: Record<string, string> = {
  "node:crypto": "Use the Web Crypto API (globalThis.crypto) instead.",
  crypto: "Use the Web Crypto API (globalThis.crypto) instead.",
  "node:buffer": "Use Uint8Array or ArrayBuffer instead.",
  buffer: "Use Uint8Array or ArrayBuffer instead.",
  "node:fs": "File system access is not available in the Tailor Platform runtime.",
  fs: "File system access is not available in the Tailor Platform runtime.",
  "node:fs/promises": "File system access is not available in the Tailor Platform runtime.",
  "node:path": "Use URL or URLPattern for path manipulation.",
  path: "Use URL or URLPattern for path manipulation.",
  "node:http": "Use the Fetch API (globalThis.fetch) for HTTP requests instead.",
  http: "Use the Fetch API (globalThis.fetch) for HTTP requests instead.",
  "node:https": "Use the Fetch API (globalThis.fetch) for HTTPS requests instead.",
  https: "Use the Fetch API (globalThis.fetch) for HTTPS requests instead.",
  "node:url": "Use the URL and URLSearchParams Web APIs instead.",
  url: "Use the URL and URLSearchParams Web APIs instead.",
  "node:util": "Use Web Standard APIs instead.",
  util: "Use Web Standard APIs instead.",
  "node:stream": "Use Web Streams API (ReadableStream, WritableStream, TransformStream) instead.",
  stream: "Use Web Streams API (ReadableStream, WritableStream, TransformStream) instead.",
  "node:stream/web":
    "Use Web Streams API (ReadableStream, WritableStream, TransformStream) instead.",
  "node:events": "Use EventTarget instead.",
  events: "Use EventTarget instead.",
  "node:zlib": "Use CompressionStream and DecompressionStream Web APIs instead.",
  zlib: "Use CompressionStream and DecompressionStream Web APIs instead.",
  "node:querystring": "Use URLSearchParams instead.",
  querystring: "Use URLSearchParams instead.",
  "node:string_decoder": "Use TextDecoder instead.",
  string_decoder: "Use TextDecoder instead.",
};

/**
 * All Node.js built-in modules that should be blocked.
 * Includes both `node:` prefixed and bare specifier forms.
 */
const NODE_BUILTINS = [
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "readline/promises",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "test",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
];

const BLOCKED_MODULES = new Set<string>();
for (const mod of NODE_BUILTINS) {
  BLOCKED_MODULES.add(mod);
  BLOCKED_MODULES.add(`node:${mod}`);
}

/**
 * Check if a module specifier is a blocked Node.js built-in.
 * @param specifier
 * @returns Whether the specifier is blocked
 */
export function isBlockedModule(specifier: string): boolean {
  return BLOCKED_MODULES.has(specifier);
}

/**
 * Get the error message for a blocked module import.
 * @param specifier
 * @returns Error message with optional suggestion for the Web Standard API alternative
 */
export function getBlockedMessage(specifier: string): string {
  const suggestion = SUGGESTIONS[specifier];
  const base = `"${specifier}" is not available in the Tailor Platform runtime.`;
  return suggestion ? `${base} ${suggestion}` : base;
}
