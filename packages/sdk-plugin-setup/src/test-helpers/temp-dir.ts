import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";

/**
 * Creates a temporary directory for the lifetime of the returned disposable.
 * Unlike `tempCwd`, the process CWD is left untouched. Use with `using` inside
 * an `aroundEach`/`aroundAll` hook so the directory is removed even when a
 * later setup step throws before the test runs:
 *
 * ```ts
 * aroundAll(async (runSuite) => {
 *   using tmp = tempDir("workflow-lint-");
 *   fs.mkdirSync(path.join(tmp.dir, ".github", "workflows"), { recursive: true });
 *   await runSuite();
 * });
 * ```
 * @param prefix - Prefix for the temporary directory name
 * @returns A `Disposable` exposing `dir`; removes the directory on dispose
 */
export function tempDir(prefix: string): Disposable & { readonly dir: string } {
  // Avoid `DisposableStack` — not in Node 22 (V8 12.4), which the SDK supports
  // (`engines.node: >=22`). `Symbol.dispose` is available since Node 20.4.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    [Symbol.dispose]() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
