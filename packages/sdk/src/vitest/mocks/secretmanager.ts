import { vi } from "vitest";
import { assertDefined } from "#/utils/assert";
import { tailorRoot, withDispose } from "./shared";

interface SecretCall {
  method: "getSecret" | "getSecrets";
  vault: string;
  name?: string;
  names?: readonly string[];
}

/** Initial fixtures for a Secret Manager mock. */
export interface MockSecretmanagerOptions {
  /** Secrets to merge over fixtures inherited from the currently installed mock. */
  secrets?: Record<string, Record<string, string>>;
}

// ---------------------------------------------------------------------------
// SecretManager Mock
// ---------------------------------------------------------------------------

// Hidden accessor key used to inherit the previous scope's secret store on
// acquisition (so secrets seeded once outside tests — e.g. from tailor.config.ts
// via setup.ts — remain visible) while still isolating per-test overrides.
const SECRET_STORE = Symbol("tailorSecretStore");

/**
 * Acquire a disposable mock for `tailor.secretmanager`. The secret store is
 * inherited (cloned) from the currently-installed mock on acquisition and
 * restored on dispose, so secrets seeded outside the test survive across
 * `using` scopes while per-test `setSecrets()` overrides stay isolated.
 * @param options - Initial Secret Manager fixtures
 * @returns Disposable SecretManager mock control object
 * @example
 * ```typescript
 * import { mockSecretmanager } from "@tailor-platform/sdk/vitest";
 *
 * test("reads secrets from vault", async () => {
 *   using sm = mockSecretmanager({ secrets: { "my-vault": { API_KEY: "sk-123" } } });
 *   sm.setSecret("my-vault", "API_KEY", "replacement");
 *   // …
 * });
 * ```
 */
export function mockSecretmanager(options: MockSecretmanagerOptions = {}) {
  const root = tailorRoot();
  const prev = root.secretmanager;

  const holder: { store: Record<string, Record<string, string>> } = {
    // prior mock state may be absent
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    store: structuredClone((prev?.[SECRET_STORE]?.store as typeof holder.store) ?? {}),
  };
  for (const [vault, secrets] of Object.entries(options.secrets ?? {})) {
    holder.store[vault] = { ...holder.store[vault], ...secrets };
  }

  async function defaultGetSecret(vault: string, name: string): Promise<string | undefined> {
    return holder.store[vault]?.[name];
  }

  async function defaultGetSecrets<const T extends readonly string[]>(
    vault: string,
    names: T,
  ): Promise<Partial<Record<T[number], string>>> {
    const vaultData = holder.store[vault] ?? {};
    const result: Record<string, string> = {};
    for (const name of names) {
      if (name in vaultData) {
        result[name] = assertDefined(vaultData[name], `vault entry missing for: ${name}`);
      }
    }
    return result as Partial<Record<T[number], string>>;
  }

  const getSecret = vi.fn(defaultGetSecret);
  const getSecrets = vi.fn(defaultGetSecrets);

  root.secretmanager = { getSecret, getSecrets, [SECRET_STORE]: holder };

  const facade = {
    /** The `getSecret` `vi.fn`. */
    getSecret,
    /** The `getSecrets` `vi.fn`. */
    getSecrets,

    setSecrets(secrets: Record<string, Record<string, string>>): void {
      holder.store = secrets;
    },

    setSecret(vault: string, name: string, value: string): void {
      holder.store[vault] ??= {};
      holder.store[vault][name] = value;
    },

    mergeSecrets(vault: string, secrets: Record<string, string>): void {
      holder.store[vault] = { ...holder.store[vault], ...secrets };
    },

    get calls(): SecretCall[] {
      // Merge both methods' calls back into chronological order via vi.fn's
      // global invocationCallOrder, so a test mixing getSecret/getSecrets sees
      // them in the order they actually ran (not all getSecret, then all getSecrets).
      const entries: { order: number; call: SecretCall }[] = [
        ...getSecret.mock.calls.map((args, i) => ({
          order: getSecret.mock.invocationCallOrder[i] ?? 0,
          call: { method: "getSecret" as const, vault: args[0] as string, name: args[1] as string },
        })),
        ...getSecrets.mock.calls.map((args, i) => ({
          order: getSecrets.mock.invocationCallOrder[i] ?? 0,
          call: {
            method: "getSecrets" as const,
            vault: args[0] as string,
            names: args[1] as readonly string[],
          },
        })),
      ];
      return entries.toSorted((a, b) => a.order - b.order).map((e) => e.call);
    },

    clear(): void {
      getSecret.mockClear();
      getSecrets.mockClear();
    },

    reset(): void {
      holder.store = {};
      getSecret.mockReset();
      getSecret.mockImplementation(defaultGetSecret);
      getSecrets.mockReset();
      getSecrets.mockImplementation(defaultGetSecrets);
    },
  };

  return withDispose(facade, () => {
    root.secretmanager = prev;
  });
}
