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
 *
 * Each method below is also re-exported as a top-level named export from this
 * module so callers can either `import * as authconnection from
 * "@tailor-platform/sdk/runtime/authconnection"` or pick individual methods.
 */
export interface TailorAuthconnectionAPI {
  /**
   * Returns the access token for the given auth connection.
   * @param connectionName - Auth connection name as defined in tailor.config
   * @returns Token payload (provider-specific shape)
   */
  getConnectionToken(connectionName: string): Promise<any>;
}

const api = (): TailorAuthconnectionAPI =>
  (globalThis as { tailor: { authconnection: TailorAuthconnectionAPI } }).tailor.authconnection;

/**
 * See {@link TailorAuthconnectionAPI.getConnectionToken}.
 * @param args - Forwarded to {@link TailorAuthconnectionAPI.getConnectionToken}
 * @returns Token payload (provider-specific shape)
 */
export const getConnectionToken: TailorAuthconnectionAPI["getConnectionToken"] = (...args) =>
  api().getConnectionToken(...args);
