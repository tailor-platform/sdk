import { injectMocks, cleanupMocks } from "./mock";

// Globals that ARE available in the Tailor Platform runtime (whitelist).
// Source: platform-core-services/service/function/runtime/src/engine/js/bootstrap.js
// plus standard ECMAScript globals and Vitest internals.
const ALLOWED_GLOBALS = new Set([
  // --- ECMAScript standard globals ---
  "globalThis",
  "Infinity",
  "NaN",
  "undefined",
  "Object",
  "Function",
  "Boolean",
  "Symbol",
  "Number",
  "BigInt",
  "Math",
  "Date",
  "String",
  "RegExp",
  "Array",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "FinalizationRegistry",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Atomics",
  "JSON",
  "Promise",
  "Proxy",
  "Reflect",
  "Error",
  "AggregateError",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "encodeURI",
  "encodeURIComponent",
  "decodeURI",
  "decodeURIComponent",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "eval",
  "Iterator",
  "AsyncIterator",

  // --- Web Standard APIs (from bootstrap.js) ---
  "console",
  "URL",
  "URLSearchParams",
  "URLPattern",
  "DOMException",
  "Event",
  "EventTarget",
  "AbortController",
  "AbortSignal",
  "atob",
  "btoa",
  "TextDecoder",
  "TextEncoder",
  "TextDecoderStream",
  "TextEncoderStream",
  "Blob",
  "File",
  "FileReader",
  "MessageChannel",
  "MessagePort",
  "CompressionStream",
  "DecompressionStream",
  "Performance",
  "PerformanceEntry",
  "PerformanceMark",
  "PerformanceMeasure",
  "ImageData",
  "structuredClone",
  "ReadableStream",
  "ReadableStreamDefaultReader",
  "ReadableByteStreamController",
  "ReadableStreamBYOBReader",
  "ReadableStreamBYOBRequest",
  "ReadableStreamDefaultController",
  "TransformStream",
  "TransformStreamDefaultController",
  "WritableStream",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
  "ByteLengthQueuingStrategy",
  "CountQueuingStrategy",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "EventSource",
  "CryptoKey",
  "crypto",
  "Crypto",
  "SubtleCrypto",
  "performance",

  // --- Platform APIs (injected by mock.ts) ---
  "tailor",
  "tailordb",
  "TailorErrors",
  "TailorErrorMessage",
  "TailorDBFileError",

  // --- Vitest internals (must keep for test runner to work) ---
  "process",
  "require",
  "module",
  "exports",
  "__vitest_worker__",
  "__vitest_mocker__",
  "VITEST_POOL_ID",
]);

export default {
  name: "tailor-runtime",
  viteEnvironment: "ssr",

  async setup(global: typeof globalThis) {
    const g = global as Record<string, unknown>;

    // Save all current globals to restore in teardown
    const allKeys = Object.getOwnPropertyNames(g);
    const saved: Record<string, PropertyDescriptor> = {};
    const removedKeys: string[] = [];

    for (const key of allKeys) {
      if (!ALLOWED_GLOBALS.has(key)) {
        const descriptor = Object.getOwnPropertyDescriptor(g, key);
        if (descriptor?.configurable) {
          saved[key] = descriptor;
          removedKeys.push(key);
        }
      }
    }

    // Remove non-whitelisted globals
    for (const key of removedKeys) {
      delete g[key];
    }

    // Inject platform API mocks
    injectMocks(global);

    return {
      teardown(global: typeof globalThis) {
        cleanupMocks(global);

        // Restore removed globals
        const g = global as Record<string, unknown>;
        for (const [key, descriptor] of Object.entries(saved)) {
          Object.defineProperty(g, key, descriptor);
        }
      },
    };
  },
};
