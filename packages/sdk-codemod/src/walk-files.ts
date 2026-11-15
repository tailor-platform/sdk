import * as fs from "node:fs";
import * as path from "pathe";

/** Directory names always excluded from file scanning. */
const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git"]);
const ALLOWED_DOT_DIRS = new Set([".github", ".circleci"]);
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/**
 * Whether codemods skip a directory named `name` when scanning files.
 * @param name - Directory name
 * @returns Whether to skip it
 */
export function shouldSkipDirectory(name: string): boolean {
  return EXCLUDE_DIRS.has(name) || (name.startsWith(".") && !ALLOWED_DOT_DIRS.has(name));
}

/**
 * Walk the files under `root` that codemods scan, skipping `node_modules`,
 * `dist`, and dot directories other than CI ones.
 * @param root - Directory to walk
 * @param relativeDir - Subdirectory of `root` to walk, used for recursion
 * @yields Each file's path relative to `root`
 */
export async function* walkFiles(root: string, relativeDir = ""): AsyncGenerator<string> {
  const absoluteDir = path.join(root, relativeDir);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      yield* walkFiles(root, relative);
      continue;
    }
    if (entry.isFile()) {
      yield relative;
    }
  }
}
