/**
 * Auth connection utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.authconnection` runtime API.
 * At runtime this delegates to `globalThis.tailor.authconnection`. Use
 * `authconnectionMock` from `@tailor-platform/sdk/vitest` to mock in unit tests.
 * @example
 * import { authconnection } from "@tailor-platform/sdk/runtime";
 *
 * const token = await authconnection.getConnectionToken("my-connection");
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Platform API surface for `tailor.authconnection`. Describes the shape the
 * platform runtime injects on `globalThis.tailor.authconnection`.
 * @internal
 */
export interface TailorAuthconnectionAPI {
  getConnectionToken(connectionName: string): Promise<any>;
}

/**
 * Returns the access token for the given auth connection.
 * @param connectionName - Auth connection name as defined in tailor.config
 * @returns Token payload (provider-specific shape)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getConnectionToken(connectionName: string): Promise<any> {
  return (
    globalThis as { tailor: { authconnection: TailorAuthconnectionAPI } }
  ).tailor.authconnection.getConnectionToken(connectionName);
}
