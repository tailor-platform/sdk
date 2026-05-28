import { builtinModules } from "node:module";

// Sobek does not implement Node's host APIs. Reject every Node built-in
// (including subpath imports like `fs/promises`) and the `node:` prefix.
// Internal `_*` modules are excluded since they are never valid user imports.
const NODE_BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));

export function isNodeBuiltinImport(source: string): boolean {
  if (source.startsWith("node:")) return true;
  const root = source.includes("/") ? source.slice(0, source.indexOf("/")) : source;
  return NODE_BUILTINS.has(root);
}
