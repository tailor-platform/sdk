/**
 * Typed wrappers for the Tailor Platform Function runtime APIs.
 *
 * Each namespace mirrors the corresponding `tailor.*` (or `tailordb.file`)
 * surface that the platform runtime exposes globally, so consumers can write:
 * @example
 * import { iconv, secretmanager, idp, workflow, file } from "@tailor-platform/sdk/runtime";
 *
 * const utf8 = iconv.convert(sjisBuffer, "Shift_JIS", "UTF-8");
 * const secret = await secretmanager.getSecret("my-vault", "API_KEY");
 * const client = new idp.Client({ namespace: "my-namespace" });
 *
 * Importing this entry does NOT activate the ambient `tailor.*` / `tailordb`
 * global types — the wrappers and their associated types are self-contained.
 * If you want to call `tailor.iconv.convert(...)` directly, add a side-effect
 * import of `@tailor-platform/sdk/runtime/globals` (or list it in tsconfig
 * `compilerOptions.types`).
 */

export * as iconv from "./iconv";
export * as secretmanager from "./secretmanager";
export * as authconnection from "./authconnection";
export * as idp from "./idp";
export * as workflow from "./workflow";
export * as context from "./context";
export * as file from "./file";
