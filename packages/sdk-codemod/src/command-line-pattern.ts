import {
  GLOBAL_BOOLEAN_FLAGS,
  GLOBAL_BOOLEAN_OPTIONS,
  GLOBAL_VALUE_FLAGS,
  GLOBAL_VALUE_OPTIONS,
} from "@tailor-platform/shared/global-options";

const UNQUOTED_CHARACTER = `\\\\[^"'\\n\\r]|[^\\s'"\`;&|\\\\]`;
const ESCAPED_DOUBLE_QUOTED = `\\\\"(?:[^\\\\\\n]|\\\\(?!"))*?\\\\"`;
const ESCAPED_SINGLE_QUOTED = `\\\\'(?:[^\\\\\\n]|\\\\(?!'))*?\\\\'`;
const ARG_VALUE = `(?:${ESCAPED_DOUBLE_QUOTED}|${ESCAPED_SINGLE_QUOTED}|'[^']*'|"(?:\\\\.|[^"\\\\])*"|${UNQUOTED_CHARACTER})+`;

const SAME_LINE_SEPARATOR = "(?:[ \\t]|\\\\\\r?\\n)+";
const ANY_LINE_SEPARATOR = "(?:\\s|\\\\\\r?\\n)+";

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

function globalOptions(separator: string, valuesMayBeOmitted: boolean): string {
  const optionalValue = valuesMayBeOmitted ? "?" : "";
  const separatedValue = valuesMayBeOmitted ? `(?!-)${ARG_VALUE}` : ARG_VALUE;
  const option = [
    `(?:${alternation(longFlags(GLOBAL_BOOLEAN_FLAGS))})(?:=${ARG_VALUE})?(?![\\w-])`,
    `(?:${alternation(longFlags(GLOBAL_VALUE_FLAGS))})(?:=${ARG_VALUE}|${separator}${separatedValue})${optionalValue}`,
    `-[${BOOLEAN_ALIASES}]+(?:=${ARG_VALUE})?(?![\\w-])`,
    `-[${BOOLEAN_ALIASES}]*[${VALUE_ALIASES}](?:=?${ARG_VALUE}|${separator}${separatedValue})${optionalValue}`,
  ].join("|");
  return `(?:${separator}(?:${option}))*`;
}

/** The `tailor-sdk` binary, with an optional version pin such as `@latest`. */
export const TAILOR_SDK_BINARY = `(?<![\\w-])tailor-sdk(?:@[^\\s'"\`]+)?(?![\\w-])`;

/** The `tailor` binary, the v1 `tailor-sdk` binary, and the Windows launcher forms of both. */
export const TAILOR_BINARY = `(?<![\\w.-])tailor(?:-sdk)?(?:\\.(?:cmd|ps1|exe))?`;

interface TailorCommandPrefixOptions {
  /** Let a line break separate the tokens, as in a folded YAML scalar; by default only a shell line continuation does. */
  crossLines?: boolean;
  /**
   * Let an option that takes a value stand without it, for a command line whose option values were
   * already removed. A value that follows after a separator then cannot start with `-`, so that the
   * next option is not read as the value, which would make the match ambiguous and exponentially slow.
   */
  valuesMayBeOmitted?: boolean;
}

/**
 * Build the source of a pattern that matches a command line up to the
 * separator before the token that follows `path`, skipping the global options
 * the CLI accepts between the first token and each subcommand name.
 * @param head - Source of the pattern that matches the first token, usually the binary
 * @param path - Subcommand names between the first token and the token to match next
 * @param options - Whether a line break separates the tokens, and whether an option may lack its value
 * @returns Source of a regular expression, without anchors or flags
 */
export function tailorCommandPrefix(
  head: string,
  path: readonly string[],
  options: TailorCommandPrefixOptions = {},
): string {
  const separator = options.crossLines ? ANY_LINE_SEPARATOR : SAME_LINE_SEPARATOR;
  const skipped = globalOptions(separator, options.valuesMayBeOmitted ?? false);
  const subcommands = path.map((name) => `${separator}${escapeRegExp(name)}${skipped}`);
  return `${head}${skipped}${subcommands.join("")}${separator}`;
}
