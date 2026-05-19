/**
 * Internal aggregate types shared by the typed wrappers in
 * `@tailor-platform/sdk/runtime/*`. Not part of the public API.
 *
 * Each wrapper (`./iconv`, `./idp`, ...) exports its own `TailorXxxAPI`
 * describing the slice of the runtime it consumes. This module assembles those
 * slices into the full top-level shape so readers have a single overview, and
 * so the ambient `var tailor` / `var tailordb` declarations in `./globals` can
 * reuse the same type without inlining the union.
 *
 * Importing this module does NOT introduce any ambient global declarations;
 * the `declare global` block lives only in `./globals`.
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
// these live here alongside the aggregate runtime types.
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
// Top-level runtime shapes — aggregate each service's API surface so the
// ambient `var tailor` / `var tailordb` declarations in `./globals` and any
// callers that need the full shape can refer to a single name.
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
