/**
 * Blocked Node.js built-in modules and their Web Standard API alternatives.
 *
 * The Tailor Platform runtime only provides Web Standard APIs.
 * These Node.js modules are not available and should be replaced with
 * the suggested alternatives.
 */
import { builtinModules } from "node:module";

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

const BLOCKED_MODULES = new Set<string>();
for (const mod of builtinModules) {
  BLOCKED_MODULES.add(mod);
  BLOCKED_MODULES.add(`node:${mod}`);
}

/**
 * Check if a module specifier is a blocked Node.js built-in.
 * @param specifier - Module specifier to check (e.g. "node:crypto", "fs")
 * @returns Whether the specifier is blocked
 */
export function isBlockedModule(specifier: string): boolean {
  return BLOCKED_MODULES.has(specifier);
}

/**
 * Get the error message for a blocked module import.
 * @param specifier - Module specifier that was blocked
 * @returns Error message with optional suggestion for the Web Standard API alternative
 */
export function getBlockedMessage(specifier: string): string {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  const suggestion = SUGGESTIONS[bare];
  const base = `"${specifier}" is not available in the Tailor Platform runtime.`;
  return suggestion ? `${base} ${suggestion}` : base;
}
