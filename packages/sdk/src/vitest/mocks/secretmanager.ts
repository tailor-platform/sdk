import { vi } from "vitest";
import { assertDefined } from "#/utils/assert";
import { tailorRoot, withDispose } from "./shared";

interface SecretCall {
  method: "getSecret" | "getSecrets";
  vault: string;
  name?: string;
  names?: readonly string[];
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
 * @returns Disposable SecretManager mock control object
 * @example
 * ```typescript
 * import { mockSecretmanager } from "@tailor-platform/sdk/vitest";
 *
 * test("reads secrets from vault", async () => {
 *   using sm = mockSecretmanager();
 *   sm.setSecrets({ "my-vault": { API_KEY: "sk-123" } });
 *   // …
 * });
 * ```
 */
export function mockSecretmanager() {
  const root = tailorRoot();
  const prev = root.secretmanager;

  const holder: { store: Record<string, Record<string, string>> } = {
    // prior mock state may be absent
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    store: structuredClone((prev?.[SECRET_STORE]?.store as typeof holder.store) ?? {}),
  };

  const getSecret = vi.fn(
    async (vault: string, name: string): Promise<string | undefined> => holder.store[vault]?.[name],
  );
  const getSecrets = vi.fn(
    async <const T extends readonly string[]>(
      vault: string,
      names: T,
    ): Promise<Partial<Record<T[number], string>>> => {
      const vaultData = holder.store[vault] ?? {};
      const result: Record<string, string> = {};
      for (const name of names) {
        if (name in vaultData) {
          result[name] = assertDefined(vaultData[name], `vault entry missing for: ${name}`);
        }
      }
      return result as Partial<Record<T[number], string>>;
    },
  );

  root.secretmanager = { getSecret, getSecrets, [SECRET_STORE]: holder };

  const facade = {
    /** The `getSecret` `vi.fn`. */
    getSecret,
    /** The `getSecrets` `vi.fn`. */
    getSecrets,

    setSecrets(secrets: Record<string, Record<string, string>>): void {
      holder.store = secrets;
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

    reset(): void {
      holder.store = {};
      getSecret.mockClear();
      getSecrets.mockClear();
    },
  };

  return withDispose(facade, () => {
    root.secretmanager = prev;
  });
}
