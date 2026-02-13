import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "pathe";

interface CliPackageJson {
  bin?: Record<string, string>;
}

type ResolveCliBinOptions = {
  packageName: string;
  binName: string;
};

/**
 * Resolve a CLI binary path from the SDK's dependencies.
 * @param options - Resolution options for locating the CLI binary.
 * @returns Absolute path to the CLI binary entry.
 */
export function resolveCliBinPath(options: ResolveCliBinOptions): string {
  const { packageName, binName } = options;

  // Resolve from SDK's dependencies instead of user's project
  const requireFromSdk = createRequire(import.meta.url);
  let pkgJsonPath: string;
  try {
    pkgJsonPath = requireFromSdk.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(`Failed to resolve \`${packageName}\`.`);
  }

  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as CliPackageJson;
  const binRelativePath = pkgJson.bin?.[binName];
  if (!binRelativePath) {
    throw new Error(`\`${packageName}\` does not expose a \`${binName}\` binary entry.`);
  }

  return path.resolve(path.dirname(pkgJsonPath), binRelativePath);
}
