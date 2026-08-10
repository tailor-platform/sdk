/**
 * Remove a named import from a `node:*` builtin when none of its bindings
 * are referenced elsewhere in the file.
 */
export function stripDeadNodeBuiltinImports(source: string): string;
