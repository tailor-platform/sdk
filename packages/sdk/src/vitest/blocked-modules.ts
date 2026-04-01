/**
 * Blocked Node.js built-in modules and their Web Standard API alternatives.
 *
 * The Tailor Platform runtime only provides Web Standard APIs.
 * These Node.js modules are not available and should be replaced with
 * the suggested alternatives.
 */

// Suggestions keyed by bare specifier. Lookup also checks with "node:" prefix stripped.
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
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  const suggestion = SUGGESTIONS[bare];
  const base = `"${specifier}" is not available in the Tailor Platform runtime.`;
  return suggestion ? `${base} ${suggestion}` : base;
}
