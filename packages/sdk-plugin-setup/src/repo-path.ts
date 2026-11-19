import * as path from "pathe";

/**
 * Tell whether a path relative to the repository root leaves it. The guard is on the path
 * segment, so a sibling-prefixed name like "..foo" stays inside.
 * @param rel - Path relative to the repository root: "" for the root itself, ".." or "../foo" for an escape
 * @returns Whether the path is absolute or climbs out of the root
 */
export function escapesRoot(rel: string): boolean {
  return rel === ".." || rel.startsWith("../") || path.isAbsolute(rel);
}
