/**
 * Sets `process.argv` to a `tailor` command line for the lifetime of the
 * returned disposable. Use with `using` so the original argv is restored when
 * the enclosing block exits.
 * @param args - Arguments after the `tailor` executable
 * @returns A `Disposable` that restores `process.argv`
 */
export function tailorArgv(args: readonly string[]): Disposable {
  const originalArgv = process.argv;
  process.argv = ["node", "tailor", ...args];
  return {
    [Symbol.dispose]() {
      process.argv = originalArgv;
    },
  };
}
