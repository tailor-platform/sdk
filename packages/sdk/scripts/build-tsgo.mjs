// Build entrypoint: run tsgo (file-by-file emit) then the postbuild rewrites.
//
// The build tsconfig needs `allowImportingTsExtensions` for the workspace
// `@tailor-proto` package to resolve under bundler module resolution, which in
// turn makes tsgo emit a benign TS5096 config diagnostic (and a couple of
// politty TS4023 "cannot be named" declaration-emit notes) and exit non-zero —
// even though it emits correct JS + declarations. Type correctness is gated by
// `pnpm typecheck` (tsc --noEmit), not by this build. So we run tsgo, ignore
// its exit code, and instead gate on the postbuild successfully finding and
// rewriting the expected output. tsgo is rerun with `clean`-like semantics by
// wiping dist first.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

rmSync(path.join(pkgRoot, "dist"), { recursive: true, force: true });

try {
  execFileSync("tsgo", ["-p", "tsconfig.build.json"], {
    cwd: pkgRoot,
    stdio: "inherit",
  });
} catch {
  // tsgo exits non-zero on the benign diagnostics described above; emission
  // still happens. postbuild validates that the expected files exist.
}

execFileSync("node", ["scripts/postbuild-tsgo.mjs"], {
  cwd: pkgRoot,
  stdio: "inherit",
});
