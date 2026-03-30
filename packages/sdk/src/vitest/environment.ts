import { injectMocks, cleanupMocks } from "./mock";

export default {
  name: "tailor-runtime",
  transformMode: "ssr",

  async setup(global: typeof globalThis) {
    // Save original values to restore in teardown
    const saved = {
      __dirname: Object.getOwnPropertyDescriptor(global, "__dirname"),
      __filename: Object.getOwnPropertyDescriptor(global, "__filename"),
    };

    // Remove Node.js-specific globals that are not available in the platform runtime.
    // Note: `process` is NOT removed because Vitest's internal runner depends on it.
    const g = global as Record<string, unknown>;
    delete g.__dirname;
    delete g.__filename;

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
