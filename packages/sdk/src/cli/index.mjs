#!/usr/bin/env node

// Enables Node's on-disk compile cache before dynamically importing the
// real CLI entry (main.ts) — ESM static import graphs compile during the
// link phase, before any code can run, so this can't happen in main.ts itself.
import * as nodeModule from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

// Keep in sync with the --program value in package.json's build script —
// a mismatch would split the compile cache from the shell-completion
// workers' cache directory instead of sharing it.
const PROGRAM_NAME = "tailor";

function compileCacheDir() {
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return join(xdg, PROGRAM_NAME, "node-compile-cache");
  try {
    const home = homedir();
    return home ? join(home, ".cache", PROGRAM_NAME, "node-compile-cache") : undefined;
  } catch {
    return undefined;
  }
}

try {
  const enable = nodeModule.enableCompileCache;
  if (typeof enable === "function") {
    // NODE_COMPILE_CACHE always wins when set, same as politty's own helper.
    const dir = process.env.NODE_COMPILE_CACHE ? undefined : compileCacheDir();
    if (dir === undefined) enable();
    else enable(dir);
  }
} catch {
  // Unsupported runtime (Node < 22.8, or a Bun build without this API) —
  // start without the compile cache rather than failing the CLI.
}

await import("./main.mjs");
