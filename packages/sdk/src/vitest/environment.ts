import * as globals from "globals";
import { STATE_KEY, injectMocks, cleanupMocks } from "./mock";

// Normalize the `globals` module shape across CJS/ESM interop so the
// whitelist build doesn't crash if the default export is unavailable or
// the keyed sets are missing. Mirrors src/cli/services/tailordb/es-builtins.ts.
type GlobalsShape = {
  builtin?: Record<string, boolean>;
  "shared-node-browser"?: Record<string, boolean>;
};
const globalsMap: GlobalsShape =
  (globals as unknown as { default?: GlobalsShape }).default ??
  (globals as unknown as GlobalsShape);

// Globals allowed in the Tailor Platform runtime.
// Mirrors ES_BUILTINS in src/cli/services/tailordb/es-builtins.ts so the
// emulated runtime exposes exactly the same identifiers as the production
// platform's free-variable allowlist (ECMAScript builtins + shared
// Node/browser runtime globals like console, fetch, setTimeout).
// Platform API mocks (tailor, tailordb, etc.) are not listed here — they are
// injected by injectMocks() after the whitelist cleanup, so they are never removed.
const ALLOWED_GLOBALS = new Set([
  ...Object.keys(globalsMap.builtin ?? {}),
  ...Object.keys(globalsMap["shared-node-browser"] ?? {}),

  // Mock state key (used by setup.ts to detect tailor-runtime environment)
  STATE_KEY,

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

    // Save and remove all non-whitelisted globals
    const saved: Record<string, PropertyDescriptor> = {};
    for (const key of Object.getOwnPropertyNames(g)) {
      if (!ALLOWED_GLOBALS.has(key)) {
        const descriptor = Object.getOwnPropertyDescriptor(g, key);
        if (descriptor?.configurable) {
          saved[key] = descriptor;
          delete g[key];
        }
      }
    }

    // Inject platform API mocks after whitelist cleanup
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
