import * as path from "pathe";
import { transformPackageScripts } from "../../../../src/package-json-scripts";

// Match the deprecated binary plus the optional `@version` suffix that
// package-manager run commands can add (`npx tailor-sdk-skills@latest`,
// `pnpm dlx tailor-sdk-skills@1.2.3`) and the optional ` install` subcommand,
// so the rewrite drops the version pin and avoids leaving `@latest` attached
// to the new subcommand. `[ \t]+` (not `\s+`) prevents the optional-install
// alternative from greedily reaching across newlines into the next command.
// A package runner in front of the binary is captured so the replacement can
// name the package instead of the binary: package-runner forms resolve a package
// name, and `npx tailor` reaches an unrelated `tailor` package on npm. The
// lookbehind keeps `pnpm exec` — which resolves project binaries — from matching
// on the `npm exec` its own name contains.
const PACKAGE_RUNNER = "(?<![\\w.-])(?:npx|bunx|(?:pnpm|yarn)[ \\t]+dlx|npm[ \\t]+exec)";
const SHIM_PATTERN = new RegExp(
  `(${PACKAGE_RUNNER}(?:[ \\t]+-{1,2}[\\w-]*)*[ \\t]+)?\\btailor-sdk-skills(?:@[^\\s'"\`]+)?(?:[ \\t]+install)?\\b(?!-)`,
  "g",
);
const CLI_BINARY = "tailor";
const CLI_PACKAGE = "@tailor-platform/sdk";

function replaceShim(value: string): string {
  return value.replace(
    SHIM_PATTERN,
    (_match, runner: string | undefined) =>
      `${runner ?? ""}${runner == null ? CLI_BINARY : CLI_PACKAGE} skills add`,
  );
}

function transformText(source: string): string | null {
  if (!SHIM_PATTERN.test(source)) return null;
  SHIM_PATTERN.lastIndex = 0;
  const updated = replaceShim(source);
  return updated === source ? null : updated;
}

function transformPackageJson(source: string): string | null {
  return transformPackageScripts(source, replaceShim);
}

/**
 * Replace `tailor-sdk-skills` invocations with `tailor skills add`.
 *
 * The standalone `tailor-sdk-skills` binary is removed in v2; users must call
 * the subcommand on the main `tailor` CLI instead.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("tailor-sdk-skills")) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  return transformText(source);
}
