import { vi } from "vitest";
import { tailorRoot, withDispose } from "./shared";
// Import from the public entry (not `#/configure/...`) so this d.ts references
// `@tailor-platform/sdk` externally instead of inlining the registry — the same
// generated `declare module "@tailor-platform/sdk"` that narrows
// `authconnection.getConnectionToken` then also narrows this mock's API.
import type { AuthConnectionTokenResult, ConnectionName } from "@tailor-platform/sdk";

interface AuthConnectionCall {
  connectionName: ConnectionName;
}

// ---------------------------------------------------------------------------
// AuthConnection Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for `tailor.authconnection`. Restored on dispose.
 * @returns Disposable AuthConnection mock control object
 * @example
 * ```typescript
 * import { mockAuthconnection } from "@tailor-platform/sdk/vitest";
 *
 * test("returns configured token", async () => {
 *   using ac = mockAuthconnection();
 *   ac.setTokens({ google: { access_token: "ya29.xxx" } });
 *   // …
 * });
 * ```
 */
export function mockAuthconnection() {
  const root = tailorRoot();
  const prev = root.authconnection;

  let tokens: Partial<Record<ConnectionName, AuthConnectionTokenResult>> = {};
  const getConnectionToken = vi.fn(
    async (connectionName: ConnectionName): Promise<AuthConnectionTokenResult> =>
      tokens[connectionName] ?? { access_token: "mock-token" },
  );

  root.authconnection = { getConnectionToken };

  const facade = {
    /** The `getConnectionToken` `vi.fn`. */
    getConnectionToken,

    setTokens(value: Partial<Record<ConnectionName, AuthConnectionTokenResult>>): void {
      tokens = value;
    },

    get calls(): AuthConnectionCall[] {
      return getConnectionToken.mock.calls.map(([connectionName]) => ({
        connectionName,
      }));
    },

    reset(): void {
      tokens = {};
      getConnectionToken.mockClear();
    },
  };

  return withDispose(facade, () => {
    root.authconnection = prev;
  });
}
