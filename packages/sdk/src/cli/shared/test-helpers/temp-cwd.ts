import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";

/**
 * Creates a temporary directory and switches the process CWD into it for the
 * lifetime of the returned disposable. Use with `using` so the original CWD is
 * restored and the directory removed when the enclosing block exits:
 *
 * ```ts
 * it("...", async () => {
 *   using tmp = tempCwd("sdk-bundler-");
 *   fs.mkdirSync(path.join(tmp.dir, "src"), { recursive: true });
 *   // ...
 * });
 * ```
 * @param prefix - Prefix for the temporary directory name
 * @returns A `Disposable` exposing `dir`; restores CWD and removes the dir on dispose
 */
export function tempCwd(prefix: string): Disposable & { readonly dir: string } {
  // Avoid `DisposableStack` — not in Node 22 (V8 12.4), which the SDK supports
  // (`engines.node: >=22`). `Symbol.dispose` is available since Node 20.4.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const originalCwd = process.cwd();
  process.chdir(dir);
  return {
    dir,
    [Symbol.dispose]() {
      process.chdir(originalCwd);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
