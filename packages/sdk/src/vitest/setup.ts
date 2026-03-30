/**
 * Vitest setup file that removes Node.js globals which Vitest depends on
 * but are not available in the Tailor Platform runtime.
 *
 * These globals cannot be removed in the environment's setup() because
 * Vitest's runner needs them during initialization. By using beforeEach/afterEach,
 * they are only removed during user test code execution.
 */
import { afterEach, beforeEach } from "vitest";

// Globals that Vitest internals depend on but don't exist in the platform runtime.
// Removed before each test, restored after.
const VITEST_ONLY_GLOBALS = ["performance"] as const;

type SavedGlobals = Record<string, PropertyDescriptor | undefined>;

let saved: SavedGlobals = {};

beforeEach(() => {
  const g = globalThis as Record<string, unknown>;
  saved = {};
  for (const key of VITEST_ONLY_GLOBALS) {
    saved[key] = Object.getOwnPropertyDescriptor(g, key);
    delete g[key];
  }
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) {
      Object.defineProperty(g, key, descriptor);
    }
  }
  saved = {};
});
