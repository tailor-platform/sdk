import * as fs from "node:fs";
import { createRequire } from "node:module";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";

interface CliPackageJson {
  bin?: Record<string, string>;
}

type ResolveCliBinOptions = {
  cwd: string;
  packageName: string;
  binName: string;
  installHint: string;
};

/**
 * Resolve a CLI binary path from the caller's project dependencies.
 * @param {ResolveCliBinOptions} options - Resolution options for locating the CLI binary.
 * @returns {string} Absolute path to the CLI binary entry.
 */
export function resolveCliBinPath({
  cwd,
  packageName,
  binName,
  installHint,
}: ResolveCliBinOptions): string {
  const projectPackageJsonPath = findUpSync("package.json", { cwd });
  if (!projectPackageJsonPath) {
    throw new Error(`Failed to locate package.json from ${cwd}.`);
  }

  const requireFromProject = createRequire(projectPackageJsonPath);
  let pkgJsonPath: string;
  try {
    pkgJsonPath = requireFromProject.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(
      `Missing optional dependency \`${packageName}\`. Install it in your project (e.g. \`${installHint}\`).`,
    );
  }

  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as CliPackageJson;
  const binRelativePath = pkgJson.bin?.[binName];
  if (!binRelativePath) {
    throw new Error(`\`${packageName}\` does not expose a \`${binName}\` binary entry.`);
  }

  return path.resolve(path.dirname(pkgJsonPath), binRelativePath);
}
