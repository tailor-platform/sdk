import { injectMocks, cleanupMocks } from "./mock";

// Node.js globals that don't exist in the Tailor Platform runtime and are safe
// to remove (Vitest's internal runner does NOT depend on these).
// `process` and `require` are NOT removed here because Vitest depends on them;
// their usage in production code is caught by the transform hook instead.
const REMOVABLE_GLOBALS = [
  "__dirname",
  "__filename",
  "Buffer",
  "global",
  "setImmediate",
  "clearImmediate",
];

export default {
  name: "tailor-runtime",
  viteEnvironment: "ssr",

  async setup(global: typeof globalThis) {
    const g = global as Record<string, unknown>;

    // Save original values to restore in teardown
    const saved: Record<string, PropertyDescriptor | undefined> = {};
    for (const key of REMOVABLE_GLOBALS) {
      saved[key] = Object.getOwnPropertyDescriptor(g, key);
    }

    // Remove Node.js-specific globals that are not available in the platform runtime.
    for (const key of REMOVABLE_GLOBALS) {
      delete g[key];
    }

    // Inject platform API mocks
    injectMocks(global);

    return {
      teardown(global: typeof globalThis) {
        // Clean up injected mocks
        cleanupMocks(global);

        // Restore original globals
        const g = global as Record<string, unknown>;
        for (const [key, descriptor] of Object.entries(saved)) {
          if (descriptor) {
            Object.defineProperty(g, key, descriptor);
          }
        }
      },
    };
  },
};
