import * as path from "pathe";
import { TAILOR_BINARY, tailorCommandPrefix } from "../../../../src/command-line-pattern";
import { transformPackageScripts } from "../../../../src/package-json-scripts";

// Match `function script` only as part of a tailor CLI invocation (`tailor`,
// the v1 `tailor-sdk` binary, or their Windows launcher forms), so a
// `function script()` declaration or prose that names the subcommand is left
// alone. The trailing lookahead keeps similarly named tokens (e.g. a
// `script.ts` file path) from being rewritten.
const COMMAND_PATTERN = new RegExp(
  `(${tailorCommandPrefix(TAILOR_BINARY, ["function"])})script(?![\\w.-])`,
  "g",
);

function replaceCommand(value: string): string {
  return value.replace(COMMAND_PATTERN, "$1scaffold");
}

function transformText(source: string): string | null {
  const updated = replaceCommand(source);
  return updated === source ? null : updated;
}

function transformPackageJson(source: string): string | null {
  return transformPackageScripts(source, replaceCommand);
}

/**
 * Rename `tailor function script` invocations to `tailor function scaffold`.
 *
 * `script` remains as a deprecated alias until v3, where only `scaffold` is
 * recognized.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("function")) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  return transformText(source);
}
