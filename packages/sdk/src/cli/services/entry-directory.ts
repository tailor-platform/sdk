import * as fs from "node:fs";
import * as path from "pathe";
import { getDistDir } from "#/cli/shared/dist-dir";

/**
 * Run a bundle build with an isolated temporary entry directory.
 * @param kind - Bundle kind used as the temporary directory prefix
 * @param build - Build callback that consumes the directory
 * @returns The build callback result
 */
export async function withTemporaryEntryDirectory<T>(
  kind: string,
  build: (entryDirectory: string) => Promise<T>,
): Promise<T> {
  const root = path.resolve(getDistDir(), ".entries");
  fs.mkdirSync(root, { recursive: true });
  const entryDirectory = fs.mkdtempSync(path.join(root, `${kind}-`));

  try {
    return await build(entryDirectory);
  } finally {
    fs.rmSync(entryDirectory, { recursive: true, force: true });
  }
}
