import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";

/**
 * Creates an empty directory under the OS temp directory and returns its real
 * path, which matches the paths bundlers and `process.cwd()` report even where
 * the temp directory sits behind a symlink (macOS's `/var` → `/private/var`).
 * The caller removes it.
 * @param prefix - Prefix for the temporary directory name
 * @returns Real path of the new directory
 */
export function makeTempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/**
 * Creates a temporary directory with {@link makeTempDir} for the lifetime of
 * the returned disposable. Unlike `tempCwd`, the process CWD is left untouched.
 * @param prefix - Prefix for the temporary directory name
 * @returns A `Disposable` exposing `dir`; removes the directory on dispose
 */
export function tempDir(prefix: string): Disposable & { readonly dir: string } {
  const dir = makeTempDir(prefix);
  return {
    dir,
    [Symbol.dispose]() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
