import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(fileURLToPath(import.meta.url));

// Invoke tsdown's JS bin script via `node` directly rather than the
// platform-specific `.bin/` shim, which is `.cmd`/`.ps1` on Windows.
const tsdownBinScript = resolve(
  dirname(createRequire(import.meta.url).resolve("tsdown/package.json")),
  "dist/run.mjs",
);

export default function setup(): void {
  const result = spawnSync(process.execPath, [tsdownBinScript], {
    cwd: packageDir,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const reason = result.signal ?? `exit code ${result.status}`;
    throw new Error(`Failed to build the plugin that rule tests lint fixtures with (${reason}).`);
  }
}
