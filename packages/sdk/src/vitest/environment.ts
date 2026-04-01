import globals from "globals";
import { injectMocks, cleanupMocks } from "./mock";

// Globals that ARE available in the Tailor Platform runtime (whitelist).
// - globals.es2025: ECMAScript standard globals
// - globals.browser: Web Standard APIs (covers everything from bootstrap.js)
// - Platform APIs: injected by mock.ts
// - Used by Vitest internally: not in the platform runtime, but required for the test runner
const ALLOWED_GLOBALS = new Set([
  ...Object.keys(globals.es2025),
  ...Object.keys(globals.browser),

  // Platform APIs (injected by mock.ts)
  "tailor",
  "tailordb",
  "TailorErrors",
  "TailorErrorMessage",
  "TailorDBFileError",

  // Used by Vitest internally — not in the platform runtime, but removing breaks the test runner
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
