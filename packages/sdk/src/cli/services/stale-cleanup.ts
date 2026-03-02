import * as fs from "node:fs/promises";
import * as path from "pathe";

/**
 * Remove stale `.entry.js` files from the output directory.
 *
 * Must be called before parallel bundling; concurrent builds
 * sharing the same output directory would otherwise conflict.
 * @param outputDir - Directory to clean
 */
export async function removeStaleEntryFiles(outputDir: string): Promise<void> {
  const files = await fs.readdir(outputDir);
  await Promise.all(
    files
      .filter((file) => file.endsWith(".entry.js"))
      .map((file) => fs.rm(path.join(outputDir, file), { force: true })),
  );
}
