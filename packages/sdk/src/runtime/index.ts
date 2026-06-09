/**
 * Typed wrappers for the Tailor Platform Function runtime APIs.
 *
 * Each namespace mirrors the corresponding `tailor.*` (or `tailordb.file`)
 * surface that the platform runtime exposes globally. The aggregate
 * `TailorRuntime` / `TailordbRuntime` types compose those per-service shapes
 * into the full top-level runtime objects, and are reused by the ambient
 * `var tailor` / `var tailordb` declarations in `./globals`.
 * @example
 * import { iconv, secretmanager, idp, workflow, file } from "@tailor-platform/sdk/runtime";
 *
 * const utf8 = iconv.convert(sjisBuffer, "Shift_JIS", "UTF-8");
 * const secret = await secretmanager.getSecret("my-vault", "API_KEY");
 * const client = new idp.Client({ namespace: "my-namespace" });
 */

import type { TailorAuthconnectionAPI } from "./authconnection";
import type { TailorContextAPI } from "./context";
import type { TailorDBFileAPI } from "./file";
import type { TailorIconvAPI } from "./iconv";
import type { TailorIdpAPI } from "./idp";
import type { TailorSecretmanagerAPI } from "./secretmanager";
import type { TailorWorkflowAPI } from "./workflow";

export * as iconv from "./iconv";
export * as secretmanager from "./secretmanager";
export * as authconnection from "./authconnection";
export * as idp from "./idp";
export * as workflow from "./workflow";
export * as context from "./context";
export * as file from "./file";
export * as wasm from "./wasm";

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
