import * as fs from "node:fs/promises";
import * as path from "pathe";

const legacyBundleDirectories: ReadonlyArray<{
  name: string;
  suffixes: readonly string[];
}> = [
  { name: "resolvers", suffixes: [".entry.js"] },
  { name: "executors", suffixes: [".entry.js"] },
  { name: "workflow-jobs", suffixes: [".js", ".js.map"] },
  { name: "auth-hooks", suffixes: [".entry.js"] },
  { name: "http-adapters", suffixes: [".entry.js"] },
];

/**
 * Remove bundle artifacts created by SDK versions that used disk-backed entries.
 *
 * Concurrent callers are safe because current bundlers no longer create files
 * in these directories and each removal uses `force: true`.
 * @param outputRoot - SDK output directory
 */
export async function removeLegacyBundleFiles(outputRoot: string): Promise<void> {
  await Promise.all([
    ...legacyBundleDirectories.map(({ name, suffixes }) =>
      removeMatchingFiles(path.join(outputRoot, name), suffixes),
    ),
    fs.rm(path.join(outputRoot, "hooks-validate-scripts"), {
      recursive: true,
      force: true,
    }),
  ]);
}

async function removeMatchingFiles(outputDir: string, suffixes: readonly string[]): Promise<void> {
  let files: string[];
  try {
    files = await fs.readdir(outputDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const file of files) {
    if (suffixes.some((suffix) => file.endsWith(suffix))) {
      await fs.rm(path.join(outputDir, file), { force: true });
    }
  }
}
