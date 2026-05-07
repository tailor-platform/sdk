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
 * Importing this module also makes the global `tailor.*` / `tailordb` types
 * available, so existing code that calls `tailor.iconv.convert(...)` directly
 * continues to type-check without any additional `@tailor-platform/sdk/runtime/globals`
 * import.
 */

// Re-export the sentinel from globals so the bundler retains the
// `declare global` chunk in the emitted `.d.mts`. Importing this entry
// therefore activates the ambient `tailor.*` / `tailordb` types without
// any additional `@tailor-platform/sdk/runtime/globals` import.
export { __TAILOR_RUNTIME_GLOBALS_LOADED__ } from "./globals";

export * as iconv from "./iconv";
export * as secretmanager from "./secretmanager";
export * as authconnection from "./authconnection";
export * as idp from "./idp";
export * as workflow from "./workflow";
export * as context from "./context";
export * as file from "./file";
