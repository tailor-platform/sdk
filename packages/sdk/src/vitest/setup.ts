/**
 * Vitest setup file that seeds the SecretManager mock and the date default
 * from `tailor.config.ts`.
 *
 * This file is auto-injected by tailorRuntime() but only activates when
 * the tailor-runtime environment is active (detected via __tailorRuntimeActive,
 * a flag set by injectMocks() during environment setup).
 */
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll } from "vitest";
import { RUNTIME_FLAG_KEY, mockSecretmanager } from "./mock";
import type { EffectiveDateDefault } from "#/runtime/date";

const DATE_DEFAULT_GATE = "__TAILOR_PLATFORM_BUNDLE_DATE_DEFAULT";

function isTailorRuntime(): boolean {
  return RUNTIME_FLAG_KEY in globalThis;
}

/**
 * Read `defaultDateRepresentation` from an imported `tailor.config.ts` module.
 * @param configModule - The imported module namespace
 * @returns The representation `t` date fields without `as` follow
 */
export function dateDefaultFromConfig(configModule: unknown): EffectiveDateDefault {
  const appConfig =
    configModule && typeof configModule === "object"
      ? (configModule as { default?: unknown }).default
      : undefined;
  const value =
    appConfig && typeof appConfig === "object"
      ? (appConfig as { defaultDateRepresentation?: unknown }).defaultDateRepresentation
      : undefined;
  return value === "temporal" ? "temporal" : "legacy";
}

/**
 * Load `defaultDateRepresentation` from a `tailor.config.ts` file.
 *
 * Unlike {@link loadSecretsFromConfig}, a config that cannot be loaded fails
 * the test run: `tailor.d.ts` already types the project's date fields from this
 * value, so silently keeping string values would hide a type/runtime mismatch.
 * @param configPath - Absolute path to tailor.config.ts
 * @returns The representation `t` date fields without `as` follow
 */
export async function loadDateDefaultFromConfig(configPath: string): Promise<EffectiveDateDefault> {
  try {
    return dateDefaultFromConfig(await import(pathToFileURL(configPath).href));
  } catch (error) {
    throw new Error(
      `tailor-runtime could not load ${configPath} to read defaultDateRepresentation. Fix the config, or drop the \`config\` option from tailorRuntime().`,
      { cause: error },
    );
  }
}

/**
 * Expose the date default to `t` date fields in this worker, the way the
 * define plugin folds it into deployed bundles.
 * @param dateDefault - The representation `t` date fields without `as` follow
 * @returns A function that restores the previous value
 */
export function applyDateDefault(dateDefault: EffectiveDateDefault): () => void {
  const previous = process.env[DATE_DEFAULT_GATE];
  if (dateDefault === "temporal") {
    process.env[DATE_DEFAULT_GATE] = dateDefault;
  } else {
    delete process.env[DATE_DEFAULT_GATE];
  }
  return () => {
    if (previous === undefined) delete process.env[DATE_DEFAULT_GATE];
    else process.env[DATE_DEFAULT_GATE] = previous;
  };
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
      ? (secrets as { vaults: Record<string, unknown> }).vaults
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
 * `mockSecretmanager().setSecrets()`.
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

// Applied at the top level, before the test file and its imports evaluate, so a
// field parsed at import time already follows the configured default.
const configuredPath = isTailorRuntime() ? process.env.__TAILOR_RUNTIME_CONFIG : undefined;
const restoreDateDefault = configuredPath
  ? applyDateDefault(await loadDateDefaultFromConfig(configuredPath))
  : undefined;
afterAll(() => restoreDateDefault?.());

// Load secrets from tailor.config.ts if config path is provided via env var
beforeAll(async () => {
  if (!isTailorRuntime()) return;
  const configPath = process.env.__TAILOR_RUNTIME_CONFIG;
  if (!configPath) return;

  const store = await loadSecretsFromConfig(configPath);
  if (store) {
    // Acquire without `using`: this is a one-time global seed that must persist
    // across tests, so we deliberately do not dispose (which would reset it).
    mockSecretmanager().setSecrets(store);
  }
});
