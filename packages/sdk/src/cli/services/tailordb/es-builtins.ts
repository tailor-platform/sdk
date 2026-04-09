import * as globals from "globals";

type GlobalsShape = {
  builtin?: Record<string, boolean>;
  "shared-node-browser"?: Record<string, boolean>;
};

const globalsMap: GlobalsShape =
  (globals as unknown as { default?: GlobalsShape }).default ??
  (globals as unknown as GlobalsShape);

/**
 * Runtime globals available in the PF execution environment.
 * Identifiers in this set are excluded from free variable detection
 * since they are always available in the runtime environment.
 *
 * Combines globals.builtin (ECMAScript language builtins) and
 * globals['shared-node-browser'] (shared runtime globals like
 * console, fetch, setTimeout, etc.) from the `globals` npm package.
 */
export const ES_BUILTINS = new Set([
  ...Object.keys(globalsMap.builtin ?? {}),
  ...Object.keys(globalsMap["shared-node-browser"] ?? {}),
]);
