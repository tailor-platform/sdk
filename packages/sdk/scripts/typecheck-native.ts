import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export function typecheckCompiler(platform: NodeJS.Platform, arch: string): "tsrs" | "typescript" {
  return (platform === "darwin" && arch === "arm64") ||
    (platform === "linux" && (arch === "x64" || arch === "arm64"))
    ? "tsrs"
    : "typescript";
}

if (import.meta.main) {
  const compiler = typecheckCompiler(process.platform, process.arch);
  if (compiler === "typescript") {
    console.error(`tsrs has no binary for ${process.platform}/${process.arch}; using tsc.`);
  }
  const require = createRequire(resolve("package.json"));
  const packageRoot = dirname(require.resolve(`${compiler}/package.json`));
  const launcher = resolve(packageRoot, compiler === "tsrs" ? "bin/tsrs" : "lib/tsc.js");
  const result = spawnSync(
    process.execPath,
    [launcher, "--noEmit", "--tsBuildInfoFile", "./.tsrs.tsbuildinfo"],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Typecheck terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
}
