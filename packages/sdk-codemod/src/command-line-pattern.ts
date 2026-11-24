import {
  GLOBAL_BOOLEAN_FLAGS,
  GLOBAL_BOOLEAN_OPTIONS,
  GLOBAL_VALUE_FLAGS,
  GLOBAL_VALUE_OPTIONS,
} from "@tailor-platform/shared/global-options";

const ARG_VALUE = `(?:[^\\s'"\`;&|]+|'[^']*'|"(?:(?:\\\\.)|[^"\\\\])*")`;

const SEPARATOR = "(?:[ \\t]|\\\\\\r?\\n)+";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function alternation(values: readonly string[]): string {
  return values
    .toSorted((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
}

const longFlags = (flags: readonly string[]) => flags.filter((flag) => flag.startsWith("--"));
const aliasesOf = (options: readonly { alias?: string }[]) =>
  options.flatMap((option) => option.alias ?? []);

const BOOLEAN_ALIASES = aliasesOf(GLOBAL_BOOLEAN_OPTIONS).join("");
const VALUE_ALIASES = aliasesOf(GLOBAL_VALUE_OPTIONS).join("");

const GLOBAL_OPTION = [
  `(?:${alternation(longFlags(GLOBAL_BOOLEAN_FLAGS))})(?:=[^\\s'"\`;&|]+)?(?![\\w-])`,
  `(?:${alternation(longFlags(GLOBAL_VALUE_FLAGS))})(?:=${ARG_VALUE}|${SEPARATOR}${ARG_VALUE})`,
  `-[${BOOLEAN_ALIASES}]+(?![\\w-])`,
  `-[${BOOLEAN_ALIASES}]*[${VALUE_ALIASES}](?:=?${ARG_VALUE}|${SEPARATOR}${ARG_VALUE})`,
].join("|");

const GLOBAL_OPTIONS = `(?:${SEPARATOR}(?:${GLOBAL_OPTION}))*`;

/** The `tailor-sdk` binary, with an optional version pin such as `@latest`. */
export const TAILOR_SDK_BINARY = `(?<![\\w-])tailor-sdk(?:@[^\\s'"\`]+)?(?![\\w-])`;

/** The `tailor` binary, the v1 `tailor-sdk` binary, and the Windows launcher forms of both. */
export const TAILOR_BINARY = `(?<![\\w.-])tailor(?:-sdk)?(?:\\.(?:cmd|ps1|exe))?`;

/**
 * Build the source of a pattern that matches a command line up to the
 * separator before the token that follows `path`, skipping the global options
 * the CLI accepts between the first token and each subcommand name.
 * @param head - Source of the pattern that matches the first token, usually the binary
 * @param path - Subcommand names between the first token and the token to match next
 * @returns Source of a regular expression, without anchors or flags
 */
export function tailorCommandPrefix(head: string, path: readonly string[]): string {
  const subcommands = path.map((name) => `${SEPARATOR}${escapeRegExp(name)}${GLOBAL_OPTIONS}`);
  return `${head}${GLOBAL_OPTIONS}${subcommands.join("")}${SEPARATOR}`;
}
