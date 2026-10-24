import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { vi } from "vitest";

/**
 * Points the OS temp directory at a symlink to a fresh real directory for the
 * lifetime of the returned disposable, reproducing macOS's `/var` →
 * `/private/var` layout on any platform:
 *
 * ```ts
 * test("...", () => {
 *   using tmpdir = symlinkedTmpdir();
 *   // os.tmpdir() now returns a symlink to tmpdir.realDir
 * });
 * ```
 * @returns A `Disposable` exposing `realDir`; restores the environment and removes both directories on dispose
 */
export function symlinkedTmpdir(): Disposable & { readonly realDir: string } {
  const realDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sdk-real-tmp-")));
  const linkDir = `${realDir}-link`;
  fs.symlinkSync(realDir, linkDir);
  vi.stubEnv("TMPDIR", linkDir);
  return {
    realDir,
    [Symbol.dispose]() {
      vi.unstubAllEnvs();
      fs.rmSync(linkDir, { force: true });
      fs.rmSync(realDir, { recursive: true, force: true });
    },
  };
}
