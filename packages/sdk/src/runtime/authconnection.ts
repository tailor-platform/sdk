/**
 * Auth connection utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.authconnection` runtime API.
 * At runtime this delegates to `globalThis.tailor.authconnection`. Use
 * `mockAuthconnection` from `@tailor-platform/sdk/vitest` to mock in unit tests.
 *
 * `connectionName` is narrowed to the connection names defined in `defineAuth()`'s
 * `connections` once `tailor.d.ts` has been generated (via `tailor-sdk deploy`/`generate`).
 * @example
 * import { authconnection } from "@tailor-platform/sdk/runtime";
 *
 * const token = await authconnection.getConnectionToken("my-connection");
 */

import type { AuthConnectionTokenResult } from "#/configure/services/auth/types";
import type { ConnectionName } from "#/configure/types/connection-name";

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
   * @returns Token payload
   */
  getConnectionToken(connectionName: ConnectionName): Promise<AuthConnectionTokenResult>;
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
