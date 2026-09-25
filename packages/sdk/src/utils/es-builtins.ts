import * as globals from "globals";

type GlobalsShape = {
  builtin?: Record<string, boolean>;
  "shared-node-browser"?: Record<string, boolean>;
  node?: Record<string, boolean>;
};

const globalsMap: GlobalsShape =
  (globals as unknown as { default?: GlobalsShape }).default ?? globals;

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

/**
 * Node-only ambient globals (`process`, `Buffer`, `require`, `setImmediate`,
 * etc.) that `@types/node` puts in the global scope but that are absent from
 * `ES_BUILTINS`, so the Tailor Platform runtime never defines them. Sourced
 * from the same `globals` package as `ES_BUILTINS` instead of a hand-curated
 * list, so a newly recognized Node-only global can't be silently omitted.
 */
export const NODE_ONLY_GLOBALS = new Set(
  Object.keys(globalsMap.node ?? {}).filter((name) => !ES_BUILTINS.has(name)),
);
