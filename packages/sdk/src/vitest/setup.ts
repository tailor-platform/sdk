/**
 * Vitest setup file that removes Node.js globals which Vitest depends on
 * but are not available in the Tailor Platform runtime.
 *
 * These globals cannot be removed in the environment's setup() because
 * Vitest's runner needs them during initialization. By using beforeEach/afterEach,
 * they are only removed during user test code execution.
 *
 * This file is auto-injected by tailorRuntime() but only activates when
 * the tailor-runtime environment is active (detected via __tailorMockState).
 */
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { secretmanagerMock } from "./mock";

// Globals that Vitest internals depend on but don't exist in the platform runtime.
// Removed before each test, restored after.
const BLOCKED_GLOBALS = ["performance"] as const;

const STATE_KEY = "__tailorMockState";

type SavedGlobals = Record<string, PropertyDescriptor | undefined>;

let saved: SavedGlobals = {};

function isTailorRuntime(): boolean {
  return STATE_KEY in globalThis;
}

// Load secrets from tailor.config.ts if config path is provided via env var
beforeAll(async () => {
  if (!isTailorRuntime()) return;
  const configPath = process.env.__TAILOR_RUNTIME_CONFIG;
  if (!configPath) return;

  try {
    // Convert to file URL so absolute Windows paths (e.g. "C:\...") parse as
    // valid ESM specifiers.
    const config = await import(pathToFileURL(configPath).href);
    // Find the defineConfig default export and extract secrets
    const appConfig = config.default;
    const secrets = appConfig?.secrets ?? config.secrets;
    if (secrets && typeof secrets === "object") {
      // Extract enumerable properties (vault data, not get/getAll methods)
      const store: Record<string, Record<string, string>> = {};
      for (const [vaultName, vaultData] of Object.entries(secrets)) {
        if (typeof vaultData === "object" && vaultData !== null) {
          store[vaultName] = { ...(vaultData as Record<string, string>) };
        }
      }
      if (Object.keys(store).length > 0) {
        secretmanagerMock.setSecrets(store);
      }
    }
  } catch {
    // Config loading failed — ignore, user can set secrets manually
  }
});

beforeEach(() => {
  if (!isTailorRuntime()) return;
  const g = globalThis as Record<string, unknown>;
  saved = {};
  for (const key of BLOCKED_GLOBALS) {
    saved[key] = Object.getOwnPropertyDescriptor(g, key);
    delete g[key];
  }
});

afterEach(() => {
  if (!isTailorRuntime()) return;
  const g = globalThis as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) {
      Object.defineProperty(g, key, descriptor);
    }
  }
  saved = {};
});
