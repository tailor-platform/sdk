/**
 * Vitest setup file that removes Node.js globals which Vitest depends on
 * but are not available in the Tailor Platform runtime.
 *
 * These globals cannot be removed in the environment's setup() because
 * Vitest's runner needs them during initialization. By using beforeEach/afterEach,
 * they are only removed during user test code execution.
 *
 * This file is auto-injected by tailorRuntime() but only activates when
 * the tailor-runtime environment is active (detected via __tailorRuntimeActive,
 * a flag set by injectMocks() during environment setup).
 */
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { RUNTIME_FLAG_KEY, secretmanagerMock } from "./mock";

// Globals that Vitest internals depend on but don't exist in the platform runtime.
// Removed before each test, restored after.
const BLOCKED_GLOBALS = ["performance"] as const;

type SavedGlobals = Record<string, PropertyDescriptor | undefined>;

let saved: SavedGlobals = {};

function isTailorRuntime(): boolean {
  return RUNTIME_FLAG_KEY in globalThis;
}

/**
 * Extract a vault store from a secrets-shaped value.
 *
 * `defineSecretManager()` returns `{ vaults, options, get, getAll }` (get/getAll
 * are non-enumerable). When that shape is present, the actual vaults live
 * under `.vaults`. Otherwise fall back to treating the object itself as the
 * vault map (for plain object configs).
 * @param secrets - Value from `appConfig.secrets` or `config.secrets`
 * @returns Vault store, or null if the value is unusable
 */
export function extractVaultStore(secrets: unknown): Record<string, Record<string, string>> | null {
  if (!secrets || typeof secrets !== "object") return null;

  const source =
    "vaults" in secrets &&
    typeof (secrets as { vaults?: unknown }).vaults === "object" &&
    (secrets as { vaults?: unknown }).vaults !== null
      ? ((secrets as { vaults: Record<string, unknown> }).vaults as Record<string, unknown>)
      : (secrets as Record<string, unknown>);

  const store: Record<string, Record<string, string>> = {};
  for (const [vaultName, vaultData] of Object.entries(source)) {
    if (typeof vaultData === "object" && vaultData !== null) {
      store[vaultName] = { ...(vaultData as Record<string, string>) };
    }
  }
  return Object.keys(store).length > 0 ? store : null;
}

/**
 * Load and parse secrets from a tailor.config.ts file.
 *
 * Returns a vault store on success, or `null` on any failure (missing config,
 * import failure, missing/invalid secrets shape). Errors are swallowed so a
 * misconfigured project still boots — the user can set secrets manually via
 * `secretmanagerMock.setSecrets()`.
 * @param configPath - Absolute path to tailor.config.ts
 * @returns Vault store keyed by vault name, or null if unavailable
 */
export async function loadSecretsFromConfig(
  configPath: string,
): Promise<Record<string, Record<string, string>> | null> {
  try {
    // Convert to file URL so absolute Windows paths (e.g. "C:\...") parse as
    // valid ESM specifiers.
    const config = await import(pathToFileURL(configPath).href);
    const appConfig = config.default;
    const secrets = appConfig?.secrets ?? config.secrets;
    return extractVaultStore(secrets);
  } catch {
    return null;
  }
}

// Load secrets from tailor.config.ts if config path is provided via env var
beforeAll(async () => {
  if (!isTailorRuntime()) return;
  const configPath = process.env.__TAILOR_RUNTIME_CONFIG;
  if (!configPath) return;

  const store = await loadSecretsFromConfig(configPath);
  if (store) {
    secretmanagerMock.setSecrets(store);
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
