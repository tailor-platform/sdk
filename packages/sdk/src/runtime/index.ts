/**
 * Typed wrappers for the Tailor Platform Function runtime APIs.
 *
 * Each namespace mirrors the corresponding `tailor.*` (or `tailordb.file`)
 * surface that the platform runtime exposes globally.
 * @example
 * import { iconv, secretmanager, idp, workflow, file } from "@tailor-platform/sdk/runtime";
 *
 * const utf8 = iconv.convert(sjisBuffer, "Shift_JIS", "UTF-8");
 * const secret = await secretmanager.getSecret("my-vault", "API_KEY");
 * const client = new idp.Client({ namespace: "my-namespace" });
 */

export * as iconv from "./iconv";
export * as secretmanager from "./secretmanager";
export * as authconnection from "./authconnection";
export * as idp from "./idp";
export * as workflow from "./workflow";
export * as context from "./context";
export * as file from "./file";
