/**
 * Internal runtime bindings shared by the typed wrappers in
 * `@tailor-platform/sdk/runtime/*`. Not part of the public API.
 *
 * - The exported `runtime` value reads `tailor` / `tailordb` from `globalThis`
 *   lazily through getters so wrappers stay decoupled from module-load order
 *   (mocks injected in `beforeEach` are picked up on next access).
 * - The exported `TailorRuntime` / `TailordbRuntime` types aggregate the
 *   per-service API surfaces (which live alongside their wrappers in
 *   `./iconv`, `./idp`, etc.) into a single global shape. Importing this
 *   module does not introduce any ambient global declarations; the
 *   `declare global` block lives only in `./globals`.
 * @internal
 */

import type { TailorAuthconnectionAPI } from "./authconnection";
import type { TailorContextAPI } from "./context";
import type { TailorDBFileAPI } from "./file";
import type { TailorIconvAPI } from "./iconv";
import type { TailorIdpAPI } from "./idp";
import type { TailorSecretmanagerAPI } from "./secretmanager";
import type { TailorWorkflowAPI } from "./workflow";

// ---------------------------------------------------------------------------
// Tailordb client types — no service wrapper exists for the SQL Client, so
// these live here alongside the runtime accessor.
// ---------------------------------------------------------------------------

/** SQL command type recorded on a {@link TailordbQueryResult}. */
export type TailordbCommandType =
  | "INSERT"
  | "DELETE"
  | "UPDATE"
  | "SELECT"
  | "MOVE"
  | "FETCH"
  | "COPY"
  | "CREATE";

/** Result of a single `queryObject` call against the TailorDB driver. */
export interface TailordbQueryResult<T> {
  rows: T[];
  command: TailordbCommandType;
  rowCount: number;
}

/** Instance methods exposed by `tailordb.Client`. */
export interface TailordbClientInstance {
  connect(): Promise<void>;
  end(): Promise<void>;
  queryObject<O>(sql: string, args?: readonly unknown[]): Promise<TailordbQueryResult<O>>;
}

/** Constructor shape for `tailordb.Client`. */
export interface TailordbClientConstructor {
  new (config: { namespace: string }): TailordbClientInstance;
}

// ---------------------------------------------------------------------------
// Top-level runtime shape — aggregates each service's API surface
// ---------------------------------------------------------------------------

/** Top-level `tailor` runtime object. */
export interface TailorRuntime {
  secretmanager: TailorSecretmanagerAPI;
  authconnection: TailorAuthconnectionAPI;
  iconv: TailorIconvAPI;
  idp: TailorIdpAPI;
  workflow: TailorWorkflowAPI;
  context: TailorContextAPI;
}

/** Top-level `tailordb` runtime object. */
export interface TailordbRuntime {
  Client: TailordbClientConstructor;
  file: TailorDBFileAPI;
}

// ---------------------------------------------------------------------------
// Lazy typed accessor — reads `tailor` / `tailordb` from globalThis on every
// property access so test setups that swap globals in `beforeEach` are picked
// up without re-importing. Importing this value does NOT activate any ambient
// global declarations.
// ---------------------------------------------------------------------------

interface RuntimeBindings {
  readonly tailor: TailorRuntime;
  readonly tailordb: TailordbRuntime;
}

/**
 * Lazy typed view of the platform runtime globals (`tailor`, `tailordb`).
 * Each property read returns the current `globalThis` value, so test setups
 * that inject mocks in `beforeEach` work without needing to re-import.
 */
export const runtime: RuntimeBindings = {
  get tailor() {
    return (globalThis as unknown as { tailor: TailorRuntime }).tailor;
  },
  get tailordb() {
    return (globalThis as unknown as { tailordb: TailordbRuntime }).tailordb;
  },
};
