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

/** Initial fixtures and fallback behavior for an AuthConnection mock. */
export interface MockAuthconnectionOptions {
  /** Tokens available when the mock is acquired. */
  tokens?: Partial<Record<ConnectionName, AuthConnectionTokenResult>>;
  /** Return a placeholder token or throw when a connection has no configured token. */
  onUnhandled?: "default" | "error";
}

// ---------------------------------------------------------------------------
// AuthConnection Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for `tailor.authconnection`. Restored on dispose.
 * @param options - Initial token fixtures and fallback behavior
 * @returns Disposable AuthConnection mock control object
 * @example
 * ```typescript
 * import { mockAuthconnection } from "@tailor-platform/sdk/vitest";
 *
 * test("returns configured token", async () => {
 *   using ac = mockAuthconnection({ tokens: { google: { access_token: "ya29.xxx" } } });
 *   ac.setToken("google", { access_token: "replacement" });
 *   // …
 * });
 * ```
 */
export function mockAuthconnection(options: MockAuthconnectionOptions = {}) {
  const root = tailorRoot();
  const prev = root.authconnection;

  let tokens: Partial<Record<ConnectionName, AuthConnectionTokenResult>> = {
    ...options.tokens,
  };

  async function defaultGetConnectionToken(
    connectionName: ConnectionName,
  ): Promise<AuthConnectionTokenResult> {
    const token = tokens[connectionName];
    if (token) return token;
    if (options.onUnhandled === "error") {
      throw new Error(`No AuthConnection token configured for "${connectionName}"`);
    }
    return { access_token: "mock-token" };
  }

  const getConnectionToken = vi.fn(defaultGetConnectionToken);

  root.authconnection = { getConnectionToken };

  const facade = {
    /** The `getConnectionToken` `vi.fn`. */
    getConnectionToken,

    setTokens(value: Partial<Record<ConnectionName, AuthConnectionTokenResult>>): void {
      tokens = value;
    },

    setToken(connectionName: ConnectionName, token: AuthConnectionTokenResult): void {
      tokens = { ...tokens, [connectionName]: token };
    },

    get calls(): AuthConnectionCall[] {
      return getConnectionToken.mock.calls.map(([connectionName]) => ({
        connectionName,
      }));
    },

    clear(): void {
      getConnectionToken.mockClear();
    },

    reset(): void {
      tokens = {};
      getConnectionToken.mockReset();
      getConnectionToken.mockImplementation(defaultGetConnectionToken);
    },
  };

  return withDispose(facade, () => {
    root.authconnection = prev;
  });
}
