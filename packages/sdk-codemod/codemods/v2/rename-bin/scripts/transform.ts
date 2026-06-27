import { parse, Lang } from "@ast-grep/napi";
import * as path from "pathe";
import type { SgNode } from "@ast-grep/napi";

const SOURCE_ARG_VALUE = `(?:[^\\s'"\`;|&]+|'[^']*'|"(?:(?:\\\\.)|[^"\\\\])*")`;
const PACKAGE_RUNNER_COMMAND = `(?:npx|bunx|(?:pnpm|yarn)(?:\\s+(?:-\\w+|--\\w[\\w-]*)(?:=${SOURCE_ARG_VALUE})?(?:\\s+(?!dlx\\b|-)${SOURCE_ARG_VALUE})?)*\\s+dlx)`;

// Package-runner forms (`npx`, `pnpm dlx`, `yarn dlx`, `bunx`) resolve npm package
// names, so `tailor-sdk@...` must become `@tailor-platform/sdk@...` — rewriting
// to `tailor@...` would download the unrelated CSS Sprites Generator instead.
// Optional flags (e.g. `-y`, `--yes`) between the runner and the package name are
// captured as part of the runner group so the replacement preserves them.
const PKG_RUNNER_RE = new RegExp(
  `\\b(${PACKAGE_RUNNER_COMMAND}(?:\\s+(?:-\\w+|--\\w[\\w-]*))*)\\s+tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?`,
  "g",
);

// Match the `tailor-sdk` binary, optionally with a version pin (`@latest`,
// `@2.0.0`, etc.). Lookbehind excludes `.tailor-sdk` (preceded by `.`) and
// `create-tailor-sdk` (preceded by `-`). Lookahead excludes trailing `-word`
// (e.g. `tailor-sdk-skills`) to avoid partial-match rewrites.
const TAILOR_SDK_RE = /(?<![.\w-])tailor-sdk(?![\w-])(@[^\s'"`;|&)]+)?/g;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const TAILOR_CLI_COMMANDS = [
  "api",
  "apply",
  "authconnection",
  "completion",
  "crash-report",
  "crashreport",
  "deploy",
  "executor",
  "function",
  "generate",
  "init",
  "login",
  "logout",
  "machineuser",
  "oauth2client",
  "open",
  "organization",
  "profile",
  "query",
  "remove",
  "secret",
  "setup",
  "show",
  "skills",
  "staticwebsite",
  "tailordb",
  "upgrade",
  "user",
  "workflow",
  "workspace",
] as const;
const TAILOR_CLI_COMMAND_PATTERN = `(?:${TAILOR_CLI_COMMANDS.join("|")})`;
const TAILOR_CLI_VALUE_FLAG =
  "(?:--env-file-if-exists|--env-file|--profile|--config|--workspace-id|--arg|--query|--file|--name|--namespace|--dir|-e|-p|-c|-w|-a|-q|-f|-n)";
const TAILOR_CLI_VALUE_FLAGS = new Set([
  "--env-file-if-exists",
  "--env-file",
  "--profile",
  "--config",
  "--workspace-id",
  "--arg",
  "--query",
  "--file",
  "--name",
  "--namespace",
  "--dir",
  "-e",
  "-p",
  "-c",
  "-w",
  "-a",
  "-q",
  "-f",
  "-n",
]);
const SOURCE_ESCAPED_QUOTED_VALUE = String.raw`\\"(?:\\\\.|[^"\\])*\\"|\\'(?:\\\\.|[^'\\])*\\'`;
const SOURCE_CLI_ARG_VALUE = `(?:${SOURCE_ESCAPED_QUOTED_VALUE}|${SOURCE_ARG_VALUE})`;
const SOURCE_COMMAND_GAP = `(?:\\s+--?[\\w-]+(?:=${SOURCE_CLI_ARG_VALUE})?(?:\\s+${SOURCE_CLI_ARG_VALUE})?)*`;
const SOURCE_RUNNER_OPTION_GAP = `(?:\\s+(?:-\\w+|--\\w[\\w-]*)(?:=${SOURCE_ARG_VALUE})?(?:\\s+(?!tailor-sdk(?![\\w-])|-)${SOURCE_ARG_VALUE})?)*`;
const SOURCE_OPTION_VALUE_REFERENCE_RE = new RegExp(
  `((?:--[\\w-]+|-\\w)(?:=|\\s+))(${SOURCE_CLI_ARG_VALUE})`,
  "g",
);
const SOURCE_TEMPLATE_EXPR_PLACEHOLDER = "__TAILOR_SDK_TEMPLATE_EXPR_\\d+_\\d+__";
const SOURCE_TEMPLATE_EXPR_PLACEHOLDER_RE = /^__TAILOR_SDK_TEMPLATE_EXPR_\d+_\d+__$/;
const SOURCE_TEMPLATE_DYNAMIC_ARGS = `\\s+${SOURCE_TEMPLATE_EXPR_PLACEHOLDER}(?:\\s+${SOURCE_ARG_VALUE})*(?=\\s*(?:$|[;&|]))`;
const SOURCE_CLI_STANDALONE_FLAG_LOOKAHEAD = "\\s+(?:--help|-h|--version|-v)\\b";
const SOURCE_DIRECT_INVOCATION_LOOKAHEAD = `(?:${SOURCE_COMMAND_GAP}\\s+${TAILOR_CLI_COMMAND_PATTERN}\\b|${SOURCE_CLI_STANDALONE_FLAG_LOOKAHEAD})`;
const SOURCE_PKG_RUNNER_COMMAND_LOOKAHEAD = `(?:${SOURCE_DIRECT_INVOCATION_LOOKAHEAD}|${SOURCE_TEMPLATE_DYNAMIC_ARGS}|\\s*$)`;
const SOURCE_PKG_RUNNER_INVOCATION_LOOKAHEAD = `(?:${SOURCE_PKG_RUNNER_COMMAND_LOOKAHEAD}|\\s+tailor-sdk(?![\\w-])(?:@[^\\s'"\`;|&)]+)?${SOURCE_PKG_RUNNER_COMMAND_LOOKAHEAD})`;
const SOURCE_DYNAMIC_OPTION_VALUE_LOOKAHEAD = `(?=\\s+${TAILOR_CLI_VALUE_FLAG}(?:=|\\s+)\\s*$)`;
const SOURCE_PKG_RUNNER_RE = new RegExp(
  `\\b(${PACKAGE_RUNNER_COMMAND}${SOURCE_RUNNER_OPTION_GAP})\\s+tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?(?=${SOURCE_PKG_RUNNER_INVOCATION_LOOKAHEAD})`,
  "g",
);
const SOURCE_PACKAGE_FLAG_VALUE_RE = new RegExp(
  `((?:-p|--package)(?:=|\\s+))tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?`,
  "g",
);
const SOURCE_PACKAGE_FLAG_EQUALS_QUOTED_VALUE_RE =
  /((?:-p|--package)=)(\\"|\\'|"|')tailor-sdk(?![\w-])(@[^\s'"`;|&)]+)?(\\"|\\'|"|')/g;
const SOURCE_PACKAGE_FLAG_BINARY_RE = new RegExp(
  `\\b(${PACKAGE_RUNNER_COMMAND}(?:(?!\\s+tailor-sdk(?![\\w-])(?:@[^\\s'"\`;|&)]+)?${SOURCE_PKG_RUNNER_COMMAND_LOOKAHEAD})\\s+${SOURCE_ARG_VALUE})*\\s+)tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?(?=${SOURCE_PKG_RUNNER_COMMAND_LOOKAHEAD})`,
  "g",
);
const SOURCE_TAILOR_SDK_RE = new RegExp(
  `(?<![.\\w-])tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?(?=${SOURCE_DIRECT_INVOCATION_LOOKAHEAD})`,
  "g",
);
const SOURCE_DYNAMIC_TAILOR_SDK_RE = new RegExp(
  `(^\\s*|[;&|]\\s*|\\b(?:pnpm|npm|yarn)(?:\\s+exec)?\\s+)tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?(?=${SOURCE_TEMPLATE_DYNAMIC_ARGS}|\\s+$)`,
  "g",
);
const SOURCE_DYNAMIC_OPTION_TAILOR_SDK_RE = new RegExp(
  `(^\\s*|[;&|]\\s*|\\b(?:pnpm|npm|yarn)(?:\\s+exec)?\\s+)tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?${SOURCE_DYNAMIC_OPTION_VALUE_LOOKAHEAD}`,
  "g",
);
const TAILOR_SDK_TOKEN_RE = /^tailor-sdk(@[^\s'"`;|&)]+)?$/;
const TAILOR_SDK_PATH_RE = /(?:^|[\\/])tailor-sdk(?![\w-])(@[^\s'"`;|&)]+)?/;
const TAILOR_CLI_TOKEN_RE =
  /^(?:tailor|tailor-sdk(?:@[^\s'"`;|&)]+)?|@tailor-platform\/sdk(?:@[^\s'"`;|&)]+)?)$/;
const CLI_ARGUMENT_CALLEE_RE = /(?:^|\.)(?:spawn|spawnSync|execFile|execFileSync|execa|execaSync)$/;
const SOURCE_EXEC_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const SOURCE_PACKAGE_RUNNERS = new Set(["bunx", "npx"]);
const SOURCE_DLX_PACKAGE_RUNNERS = new Set(["pnpm", "yarn"]);
const PACKAGE_MANAGER_OPTION_VALUE_FLAGS = new Set([
  "--registry",
  "--cache",
  "--userconfig",
  "--prefix",
  "--filter",
  "-F",
  "--dir",
  "-C",
  "--cwd",
]);
const SOURCE_PACKAGE_FLAG_RE = /^(?:-p|--package)(?:=.*)?$/;
const NPX_OPTION_WITH_VALUE = "(?:--registry|--cache|--userconfig|--prefix)";
const NPX_PACKAGE_FLAG_CONTEXT_RE = new RegExp(
  `(?:^|[;&|]\\s*)npx(?:\\s+(?:${NPX_OPTION_WITH_VALUE}\\s+${SOURCE_ARG_VALUE}|-\\w+|--\\w[\\w-]*(?:=${SOURCE_ARG_VALUE})?))*\\s*$`,
);
const SOURCE_TOKEN_RE = new RegExp(SOURCE_CLI_ARG_VALUE, "g");
const CLI_RENAME_LEGACY_RE = /(?<![\w-])(?:apply|crash-report|--machineuser)(?![\w-])/;
const TAILOR_PLATFORM_SDK_TOKEN_RE = /^@tailor-platform\/sdk(@[^\s'"`;|&)]+)?$/;
const RUNNER_OPTION_VALUE_FLAGS = new Set([
  "--registry",
  "--cache",
  "--userconfig",
  "--prefix",
  "--filter",
  "-F",
  "--dir",
  "-C",
  "--cwd",
]);

function renameBinary(value: string): string {
  const withRunners = value.replace(PKG_RUNNER_RE, (_, runner: string, version?: string) =>
    version ? `${runner} @tailor-platform/sdk${version}` : `${runner} @tailor-platform/sdk`,
  );
  return withRunners.replace(TAILOR_SDK_RE, (_match, version?: string) =>
    version ? `@tailor-platform/sdk${version}` : "tailor",
  );
}

function renamePackageName(value: string): string {
  return value.replace(TAILOR_SDK_TOKEN_RE, (_match, version?: string) =>
    version ? `@tailor-platform/sdk${version}` : "@tailor-platform/sdk",
  );
}

function renameSourcePackageToken(token: string): string | null {
  const value = sourceTokenValue(token);
  if (!TAILOR_SDK_TOKEN_RE.test(value)) return null;
  return replaceSourceTokenValue(token, renamePackageName(value));
}

function renameSourceBinaryToken(token: string): string | null {
  const value = sourceTokenValue(token);
  if (!TAILOR_SDK_TOKEN_RE.test(value)) return null;
  return replaceSourceTokenValue(token, value.includes("@") ? renamePackageName(value) : "tailor");
}

function isTailorPackageValue(value: string): boolean {
  return (
    TAILOR_SDK_TOKEN_RE.test(value) ||
    TAILOR_PLATFORM_SDK_TOKEN_RE.test(value) ||
    SOURCE_TEMPLATE_EXPR_PLACEHOLDER_RE.test(value)
  );
}

function replaceSourceSpans(
  value: string,
  replacements: Map<number, string>,
  tokens: Array<{ start: number; end: number }>,
): string {
  let updated = value;
  for (const [index, replacement] of [...replacements.entries()].toSorted(([a], [b]) => b - a)) {
    const token = tokens[index];
    if (token == null) continue;
    updated = `${updated.slice(0, token.start)}${replacement}${updated.slice(token.end)}`;
  }
  return updated;
}

function protectSourceCliValueReferences(value: string): {
  source: string;
  protectedValues: string[];
} {
  const protectedValues: string[] = [];
  const source = value.replace(
    SOURCE_OPTION_VALUE_REFERENCE_RE,
    (match: string, prefix: string, arg: string, offset: number) => {
      if (!arg.includes("tailor-sdk")) return match;
      const flag = sourceOptionFlag(prefix);
      const afterPackageRunner = isAfterPackageRunnerPrefix(value, offset);
      if (afterPackageRunner && !isPackageRunnerOptionValue(value, offset, flag)) {
        return match;
      }
      if (!afterPackageRunner && !isAfterTailorCliToken(value, offset)) {
        return match;
      }
      if (isPackageFlag(flag) && NPX_PACKAGE_FLAG_CONTEXT_RE.test(value.slice(0, offset))) {
        return match;
      }
      const placeholder = `__TAILOR_SDK_SOURCE_VALUE_${protectedValues.length}__`;
      protectedValues.push(arg);
      return `${prefix}${placeholder}`;
    },
  );
  return { source, protectedValues };
}

function restoreSourceCliValueReferences(value: string, protectedValues: string[]): string {
  let restored = value;
  for (const [index, protectedValue] of protectedValues.entries()) {
    restored = restored.replaceAll(`__TAILOR_SDK_SOURCE_VALUE_${index}__`, protectedValue);
  }
  return restored;
}

function sourceOptionFlag(prefix: string): string {
  return prefix.trim().replace(/[=\s].*$/, "");
}

function isPackageFlag(value: string): boolean {
  return value === "-p" || value === "--package";
}

function sourceTokens(value: string): string[] | null {
  const tokens = sourceTokenSpans(value);
  return tokens == null ? null : tokens.map((token) => token.value);
}

function sourceTokenSpans(value: string): Array<{
  start: number;
  end: number;
  text: string;
  value: string;
}> | null {
  const tokens: string[] = [];
  SOURCE_TOKEN_RE.lastIndex = 0;
  let lastEnd = 0;
  for (const match of value.matchAll(SOURCE_TOKEN_RE)) {
    if (value.slice(lastEnd, match.index).trim() !== "") return null;
    tokens.push(sourceTokenValue(match[0]));
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  if (value.slice(lastEnd).trim() !== "") return null;

  return [...value.matchAll(new RegExp(SOURCE_CLI_ARG_VALUE, "g"))].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    text: match[0],
    value: sourceTokenValue(match[0]),
  }));
}

function sourceTokenValue(token: string): string {
  if (token.startsWith('\\"') && token.endsWith('\\"')) return token.slice(2, -2);
  if (token.startsWith("\\'") && token.endsWith("\\'")) return token.slice(2, -2);
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1);
  if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1);
  return token;
}

function replaceSourceTokenValue(token: string, replacement: string): string {
  if (token.startsWith('\\"') && token.endsWith('\\"')) return `\\"${replacement}\\"`;
  if (token.startsWith("\\'") && token.endsWith("\\'")) return `\\'${replacement}\\'`;
  if (token.startsWith('"') && token.endsWith('"')) return `"${replacement}"`;
  if (token.startsWith("'") && token.endsWith("'")) return `'${replacement}'`;
  return replacement;
}

function activeQuoteStart(source: string, start: number, offset: number): number | null {
  let quote: { delimiter: string; escaped: boolean; start: number } | null = null;
  for (let index = start; index < offset; index += 1) {
    const char = source[index];
    if (quote != null) {
      if (quote.escaped) {
        if (char === "\\" && source[index + 1] === quote.delimiter) {
          quote = null;
          index += 1;
        }
      } else if (char === "\\") {
        index += 1;
      } else if (char === quote.delimiter) {
        quote = null;
      }
      continue;
    }
    if (char === "\\" && (source[index + 1] === '"' || source[index + 1] === "'")) {
      quote = { delimiter: source[index + 1]!, escaped: true, start: index };
      index += 1;
    } else if (char === '"' || char === "'") {
      quote = { delimiter: char, escaped: false, start: index };
    }
  }
  return quote?.start ?? null;
}

function skipsRunnerOptionValue(token: string): boolean {
  return RUNNER_OPTION_VALUE_FLAGS.has(token.split("=", 1)[0]!) && !token.includes("=");
}

function isPotentialValueFlag(value: string): boolean {
  const flag = value.split("=", 1)[0]!;
  return /^--[\w-]+$/.test(flag) || /^-\w$/.test(flag);
}

function packageRunnerPackageStartTokenIndex(tokens: readonly string[]): number | null {
  const executable = tokens[0];
  if (executable === "npx" || executable === "bunx") {
    return 1;
  } else if (executable === "pnpm" || executable === "yarn") {
    let index = 1;
    for (; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token === "dlx") {
        return index + 1;
      }
      if (token.startsWith("-")) {
        if (skipsRunnerOptionValue(token)) index += 1;
        continue;
      }
      return null;
    }
  }
  return null;
}

function renameSourcePackageRunnerTokens(value: string): string {
  const spans = sourceTokenSpans(value);
  if (spans == null) return value;
  const tokens = spans.map((span) => span.value);
  const start = packageRunnerPackageStartTokenIndex(tokens);
  if (start == null) return value;

  const replacements = new Map<number, string>();
  let hasPackageFlag = false;
  let hasTailorPackageFlag = false;

  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (SOURCE_PACKAGE_FLAG_RE.test(token)) {
      hasPackageFlag = true;
      if (token.includes("=")) {
        const [flag, rawValue = ""] = spans[index]!.text.split(/=(.*)/s, 2);
        const packageReplacement = renameSourcePackageToken(rawValue);
        if (packageReplacement != null) {
          replacements.set(index, `${flag}=${packageReplacement}`);
          hasTailorPackageFlag = true;
        } else if (isTailorPackageValue(sourceTokenValue(rawValue))) {
          hasTailorPackageFlag = true;
        }
      } else {
        const valueIndex = index + 1;
        const value = spans[valueIndex];
        if (value != null) {
          const packageReplacement = renameSourcePackageToken(value.text);
          if (packageReplacement != null) {
            replacements.set(valueIndex, packageReplacement);
            hasTailorPackageFlag = true;
          } else if (isTailorPackageValue(value.value)) {
            hasTailorPackageFlag = true;
          }
        }
        index += 1;
      }
      continue;
    }

    if (token.startsWith("-")) {
      if (skipsRunnerOptionValue(token)) index += 1;
      continue;
    }

    if (!hasPackageFlag) {
      const packageReplacement = renameSourcePackageToken(spans[index]!.text);
      if (packageReplacement != null) replacements.set(index, packageReplacement);
      break;
    }

    if (hasTailorPackageFlag) {
      const binaryReplacement = renameSourceBinaryToken(spans[index]!.text);
      if (binaryReplacement != null) replacements.set(index, binaryReplacement);
    }
    break;
  }

  return replacements.size === 0 ? value : replaceSourceSpans(value, replacements, spans);
}

function hasPositionalPackageBeforeSourcePackageFlag(
  tokens: readonly string[],
  start: number,
): boolean {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (SOURCE_PACKAGE_FLAG_RE.test(token)) {
      if (!token.includes("=")) index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      if (skipsRunnerOptionValue(token)) index += 1;
      continue;
    }
    return true;
  }
  return false;
}

function firstRunnerPackageToken(tokens: string[]): string | null {
  const start = packageRunnerPackageStartTokenIndex(tokens);
  if (start == null) return null;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.startsWith("-")) {
      if (skipsRunnerOptionValue(token)) index += 1;
      continue;
    }
    return token;
  }
  return null;
}

function isPackageRunnerOptionValue(source: string, offset: number, flag: string): boolean {
  if (!RUNNER_OPTION_VALUE_FLAGS.has(flag)) return false;
  const segmentStart = Math.max(
    source.lastIndexOf(";", offset - 1),
    source.lastIndexOf("&", offset - 1),
    source.lastIndexOf("|", offset - 1),
  );
  const tokens = sourceTokens(source.slice(segmentStart + 1, offset).trim());
  const executable = tokens?.[0];
  return (
    executable === "npx" || executable === "bunx" || executable === "pnpm" || executable === "yarn"
  );
}

function isAfterPackageRunnerPrefix(source: string, offset: number): boolean {
  const segmentStart = Math.max(
    source.lastIndexOf(";", offset - 1),
    source.lastIndexOf("&", offset - 1),
    source.lastIndexOf("|", offset - 1),
  );
  const tokens = sourceTokens(source.slice(segmentStart + 1, offset).trim());
  const executable = tokens?.[0];
  return (
    executable === "npx" || executable === "bunx" || executable === "pnpm" || executable === "yarn"
  );
}

function isPackageFlagValueInPackageRunner(source: string, offset: number): boolean {
  const segmentStart = Math.max(
    source.lastIndexOf(";", offset - 1),
    source.lastIndexOf("&", offset - 1),
    source.lastIndexOf("|", offset - 1),
  );
  const tokens = sourceTokens(source.slice(segmentStart + 1, offset).trim());
  if (tokens == null) return false;
  const start = packageRunnerPackageStartTokenIndex(tokens);
  return start != null && !hasPositionalPackageBeforeSourcePackageFlag(tokens, start);
}

function sourcePackageFlagsAllowBinaryRewrite(source: string): boolean {
  const tokens = sourceTokens(source.trim());
  if (tokens == null) return false;
  const start = packageRunnerPackageStartTokenIndex(tokens);
  if (start == null) return false;

  let hasPackageFlag = false;
  let hasTailorPackageFlag = false;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (SOURCE_PACKAGE_FLAG_RE.test(token)) {
      hasPackageFlag = true;
      const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : tokens[index + 1];
      if (
        value != null &&
        (TAILOR_CLI_TOKEN_RE.test(value) || SOURCE_TEMPLATE_EXPR_PLACEHOLDER_RE.test(value))
      ) {
        hasTailorPackageFlag = true;
      }
      if (!token.includes("=")) index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      if (skipsRunnerOptionValue(token)) index += 1;
      continue;
    }
    return false;
  }
  return hasPackageFlag && hasTailorPackageFlag;
}

function isAfterOtherPackageRunner(source: string, offset: number): boolean {
  const segmentStart = Math.max(
    source.lastIndexOf(";", offset - 1),
    source.lastIndexOf("&", offset - 1),
    source.lastIndexOf("|", offset - 1),
  );
  const segment = source.slice(segmentStart + 1, offset).trim();
  const tokens = sourceTokens(segment);
  if (tokens == null) {
    const quoteStart = activeQuoteStart(source, segmentStart + 1, offset);
    if (quoteStart == null) return false;
    const prefixTokens = sourceTokens(source.slice(segmentStart + 1, quoteStart).trim());
    const packageToken = prefixTokens == null ? null : firstRunnerPackageToken(prefixTokens);
    return packageToken != null && !TAILOR_SDK_TOKEN_RE.test(packageToken);
  }
  const packageToken = firstRunnerPackageToken(tokens);
  return packageToken != null && !TAILOR_SDK_TOKEN_RE.test(packageToken);
}

function isAfterTailorCliToken(source: string, offset: number): boolean {
  const segmentStart = Math.max(
    source.lastIndexOf(";", offset - 1),
    source.lastIndexOf("&", offset - 1),
    source.lastIndexOf("|", offset - 1),
  );
  const segment = source.slice(segmentStart + 1, offset).trim();
  const tokens = sourceTokens(segment);
  return tokens != null && tokens.some((token) => TAILOR_CLI_TOKEN_RE.test(token));
}

function isAfterTemplatePlaceholder(source: string, offset: number): boolean {
  const segmentStart = Math.max(
    source.lastIndexOf(";", offset - 1),
    source.lastIndexOf("&", offset - 1),
    source.lastIndexOf("|", offset - 1),
  );
  const segment = source.slice(segmentStart + 1, offset).trim();
  const tokens = sourceTokens(segment);
  return tokens != null && tokens.some((token) => SOURCE_TEMPLATE_EXPR_PLACEHOLDER_RE.test(token));
}

function isTemplateSubstitutionCliValue(text: string, offset: number): boolean {
  const tokens = sourceTokens(text.slice(0, offset).trimEnd());
  if (tokens == null || tokens.length === 0) return false;
  const previous = tokens.at(-1)!;
  if (!isTailorCliValueFlag(previous)) return false;
  return tokens.slice(0, -1).some((token) => TAILOR_CLI_TOKEN_RE.test(token));
}

function needsCliRenameMigration(value: string): boolean {
  return value.includes("tailor-sdk") && CLI_RENAME_LEGACY_RE.test(value);
}

function renameSourceCommandText(value: string): string {
  if (needsCliRenameMigration(value)) return value;

  const protectedValue = protectSourceCliValueReferences(value);
  const withQuotedPackageFlagValues = protectedValue.source.replace(
    SOURCE_PACKAGE_FLAG_EQUALS_QUOTED_VALUE_RE,
    (
      match: string,
      prefix: string,
      openQuote: string,
      version: string | undefined,
      closeQuote: string,
      offset: number,
      source: string,
    ) => {
      if (!isPackageFlagValueInPackageRunner(source, offset)) return match;
      const packageName = version ? `@tailor-platform/sdk${version}` : "@tailor-platform/sdk";
      return `${prefix}${openQuote}${packageName}${closeQuote}`;
    },
  );
  const withTokenPackageRunners = renameSourcePackageRunnerTokens(withQuotedPackageFlagValues);
  const withPackageFlagValues = withTokenPackageRunners.replace(
    SOURCE_PACKAGE_FLAG_VALUE_RE,
    (
      match: string,
      prefix: string,
      version: string | undefined,
      offset: number,
      source: string,
    ) => {
      if (!isPackageFlagValueInPackageRunner(source, offset)) return match;
      return version ? `${prefix}@tailor-platform/sdk${version}` : `${prefix}@tailor-platform/sdk`;
    },
  );
  const withPackageRunners = withPackageFlagValues.replace(
    SOURCE_PKG_RUNNER_RE,
    (match: string, runner: string, version?: string) => {
      if (/\s(?:-p|--package)(?:=|\s|$)/.test(runner)) return match;
      return version
        ? `${runner} @tailor-platform/sdk${version}`
        : `${runner} @tailor-platform/sdk`;
    },
  );
  const withPackageFlagBinaries = withPackageRunners.replace(
    SOURCE_PACKAGE_FLAG_BINARY_RE,
    (match: string, prefix: string, version?: string) => {
      if (!/\s(?:-p|--package)(?:=|\s)/.test(prefix)) return match;
      if (/(?:^|\s)(?:-p|--package)\s+$/.test(prefix)) return match;
      if (!sourcePackageFlagsAllowBinaryRewrite(prefix)) return match;
      return version ? `${prefix}@tailor-platform/sdk${version}` : `${prefix}tailor`;
    },
  );
  const withCommands = withPackageFlagBinaries.replace(
    SOURCE_TAILOR_SDK_RE,
    (match: string, version: string | undefined, offset: number, source: string) => {
      if (isAfterOtherPackageRunner(source, offset)) return match;
      if (isAfterTemplatePlaceholder(source, offset)) return match;
      return version ? `@tailor-platform/sdk${version}` : "tailor";
    },
  );
  const withDynamicCommands = withCommands.replace(
    SOURCE_DYNAMIC_TAILOR_SDK_RE,
    (_match, prefix: string, version?: string) =>
      version ? `${prefix}@tailor-platform/sdk${version}` : `${prefix}tailor`,
  );
  const updated = withDynamicCommands.replace(
    SOURCE_DYNAMIC_OPTION_TAILOR_SDK_RE,
    (_match, prefix: string, version?: string) =>
      version ? `${prefix}@tailor-platform/sdk${version}` : `${prefix}tailor`,
  );
  return restoreSourceCliValueReferences(updated, protectedValue.protectedValues);
}

function sourceLang(filePath: string): Lang {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".tsx" || ext === ".jsx" || ext === ".js" ? Lang.Tsx : Lang.TypeScript;
}

function pushSourceTextEdit(
  edits: Array<[number, number, string]>,
  source: string,
  start: number,
  end: number,
): void {
  const text = source.slice(start, end);
  const replacement = renameSourceCommandText(text);
  if (replacement !== text) {
    edits.push([start, end, replacement]);
  }
}

function nodeRangeKey(node: SgNode): string {
  const range = node.range();
  return `${range.start.index}:${range.end.index}`;
}

function sourceStringContent(node: SgNode, source: string): string | null {
  const kind = node.kind();
  if (kind !== "string" && kind !== "template_string") return null;
  if (
    kind === "template_string" &&
    node.children().some((child: SgNode) => child.kind() === "template_substitution")
  ) {
    return null;
  }
  const range = node.range();
  return source.slice(range.start.index + 1, range.end.index - 1);
}

function sourceStringRawContent(node: SgNode, source: string): string | null {
  const kind = node.kind();
  if (kind !== "string" && kind !== "template_string") return null;
  const range = node.range();
  return source.slice(range.start.index + 1, range.end.index - 1);
}

function isSyntaxOnlyNode(node: SgNode): boolean {
  const kind = node.kind();
  return (
    kind === "[" ||
    kind === "]" ||
    kind === "(" ||
    kind === ")" ||
    kind === "," ||
    kind === "comment"
  );
}

function sourceArrayElements(node: SgNode): SgNode[] {
  return node.children().filter((child: SgNode) => !isSyntaxOnlyNode(child));
}

function nodeIndex(nodes: SgNode[], node: SgNode): number {
  return nodes.findIndex((child: SgNode) => nodeRangeKey(child) === nodeRangeKey(node));
}

function callExpressionCalleeText(argumentsNode: SgNode): string | null {
  const parentRange = nodeRangeKey(argumentsNode);
  const call = argumentsNode.parent();
  if (call?.kind() !== "call_expression") return null;
  const callee = call.children().find((child: SgNode) => nodeRangeKey(child) !== parentRange);
  return callee?.text() ?? null;
}

function firstNonOptionIndex(elements: SgNode[], start: number, source: string): number | null {
  for (let index = start; index < elements.length; index += 1) {
    const value = sourceStringContent(elements[index]!, source);
    if (value == null) return null;
    if (!value.startsWith("-")) return index;
    if (PACKAGE_MANAGER_OPTION_VALUE_FLAGS.has(value.split("=", 1)[0]!) && !value.includes("=")) {
      index += 1;
    }
  }
  return null;
}

function isTailorCliValueFlag(value: string): boolean {
  return TAILOR_CLI_VALUE_FLAGS.has(value.split("=", 1)[0]!) || isPotentialValueFlag(value);
}

function packageRunnerPackageStartIndex(
  executable: string,
  elements: SgNode[],
  source: string,
): number | null {
  if (SOURCE_PACKAGE_RUNNERS.has(executable)) return 0;
  if (!SOURCE_DLX_PACKAGE_RUNNERS.has(executable)) return null;
  const dlxIndex = firstNonOptionIndex(elements, 0, source);
  if (dlxIndex == null || sourceStringContent(elements[dlxIndex]!, source) !== "dlx") {
    return null;
  }
  return dlxIndex + 1;
}

function hasPackageFlagBeforeArrayPackage(
  elements: SgNode[],
  index: number,
  source: string,
  start: number,
): boolean {
  for (let currentIndex = start; currentIndex < index; currentIndex += 1) {
    const value = sourceStringContent(elements[currentIndex]!, source);
    if (value == null) return false;
    if (SOURCE_PACKAGE_FLAG_RE.test(value)) return true;
    if (value.startsWith("-")) {
      if (skipsRunnerOptionValue(value)) currentIndex += 1;
      continue;
    }
    return false;
  }
  return false;
}

function isKnownTailorPackageValue(value: string | null): boolean {
  return (
    value != null && (TAILOR_SDK_TOKEN_RE.test(value) || TAILOR_PLATFORM_SDK_TOKEN_RE.test(value))
  );
}

function hasTailorPackageFlagBeforeArrayCommand(
  elements: SgNode[],
  index: number,
  source: string,
  start: number,
): boolean {
  for (let currentIndex = start; currentIndex < index; currentIndex += 1) {
    const value = sourceStringContent(elements[currentIndex]!, source);
    if (value == null) return false;
    if (SOURCE_PACKAGE_FLAG_RE.test(value)) {
      if (value.includes("=")) {
        if (isKnownTailorPackageValue(value.slice(value.indexOf("=") + 1))) return true;
      } else {
        const nextValue = sourceStringContent(elements[currentIndex + 1]!, source);
        if (isKnownTailorPackageValue(nextValue)) return true;
        currentIndex += 1;
      }
      continue;
    }
    if (value.startsWith("-")) {
      if (skipsRunnerOptionValue(value)) currentIndex += 1;
      continue;
    }
    return false;
  }
  return false;
}

function isSplitPackageFlagValue(
  elements: SgNode[],
  index: number,
  source: string,
  start: number,
): boolean {
  const previous = elements[index - 1];
  if (previous == null) return false;
  const previousValue = sourceStringContent(previous, source);
  return (
    (previousValue === "-p" || previousValue === "--package") &&
    hasPackageFlagBeforeArrayPackage(elements, index, source, start)
  );
}

function sourcePackageFlagReplacement(
  node: SgNode,
  source: string,
): { text: string; replacement: string } | null {
  const text = sourceStringContent(node, source);
  if (text == null) return null;
  const match = /^(?<prefix>-p=|--package=)tailor-sdk(?<version>@[^\s'"`;|&)]+)?$/.exec(text);
  if (match?.groups == null) return null;
  const parent = node.parent();
  if (parent?.kind() !== "array" || !isPackageRunnerArrayArgument(node, source)) return null;
  const argumentsNode = parent.parent();
  if (argumentsNode?.kind() !== "arguments") return null;
  const callArgs = sourceArrayElements(argumentsNode);
  const executableNode = callArgs[0];
  if (executableNode == null) return null;
  const executable = sourceStringContent(executableNode, source);
  if (executable == null) return null;
  const elements = sourceArrayElements(parent);
  const index = nodeIndex(elements, node);
  const start = packageRunnerPackageStartIndex(executable, elements, source);
  if (index < 0 || start == null) return null;
  if (!hasPackageFlagBeforeArrayPackage(elements, index + 1, source, start)) return null;
  return {
    text,
    replacement: `${match.groups.prefix}${renamePackageName(
      `tailor-sdk${match.groups.version ?? ""}`,
    )}`,
  };
}

function firstTailorPackageIndex(elements: SgNode[], start: number, source: string): number | null {
  for (let index = start; index < elements.length; index += 1) {
    const value = sourceStringContent(elements[index]!, source);
    if (value == null) return null;
    if (value.startsWith("-")) {
      if (skipsRunnerOptionValue(value)) index += 1;
      continue;
    }
    if (TAILOR_SDK_TOKEN_RE.test(value)) {
      return index;
    }
    return null;
  }
  return null;
}

function isPackageRunnerArrayArgument(node: SgNode, source: string): boolean {
  const parent = node.parent();
  if (parent?.kind() !== "array") return false;

  const argumentsNode = parent.parent();
  if (argumentsNode?.kind() !== "arguments") return false;
  const callee = callExpressionCalleeText(argumentsNode);
  if (!CLI_ARGUMENT_CALLEE_RE.test(callee ?? "")) return false;

  const callArgs = sourceArrayElements(argumentsNode);
  const executableNode = callArgs[0];
  if (executableNode == null) return false;
  const executable = sourceStringContent(executableNode, source);
  if (executable == null) return false;

  if (executable === "bunx" || executable === "npx") return true;
  if (executable !== "pnpm" && executable !== "yarn") return false;

  const elements = sourceArrayElements(parent);
  const dlxIndex = firstNonOptionIndex(elements, 0, source);
  return dlxIndex != null && sourceStringContent(elements[dlxIndex]!, source) === "dlx";
}

function isPackageRunnerPackageArgument(node: SgNode, source: string): boolean {
  const parent = node.parent();
  if (parent?.kind() !== "array" || !isPackageRunnerArrayArgument(node, source)) return false;

  const argumentsNode = parent.parent();
  if (argumentsNode?.kind() !== "arguments") return false;
  const callArgs = sourceArrayElements(argumentsNode);
  const executableNode = callArgs[0];
  if (executableNode == null) return false;
  const executable = sourceStringContent(executableNode, source);
  if (executable == null) return false;

  const elements = sourceArrayElements(parent);
  const index = nodeIndex(elements, node);
  if (index < 0) return false;
  const start = packageRunnerPackageStartIndex(executable, elements, source);
  if (start == null) return false;

  if (hasPackageFlagBeforeArrayPackage(elements, index, source, start)) {
    return isSplitPackageFlagValue(elements, index, source, start);
  }

  return firstTailorPackageIndex(elements, start, source) === index;
}

function isPackageRunnerCommandBinaryArgument(node: SgNode, source: string): boolean {
  const parent = node.parent();
  if (parent?.kind() !== "array" || !isPackageRunnerArrayArgument(node, source)) return false;

  const elements = sourceArrayElements(parent);
  const index = nodeIndex(elements, node);
  if (index < 0) return false;

  const argumentsNode = parent.parent();
  if (argumentsNode?.kind() !== "arguments") return false;
  const callArgs = sourceArrayElements(argumentsNode);
  const executableNode = callArgs[0];
  if (executableNode == null) return false;
  const executable = sourceStringContent(executableNode, source);
  if (executable == null) return false;
  const start = packageRunnerPackageStartIndex(executable, elements, source);
  if (start == null || !hasTailorPackageFlagBeforeArrayCommand(elements, index, source, start)) {
    return false;
  }
  if (arrayHasCliRenameLegacyArgs(elements, index + 1, source)) return false;
  const commandIndex = packageRunnerCommandIndex(elements, start, source);
  if (commandIndex !== index) return false;

  const text = sourceStringContent(node, source);
  return (
    text != null &&
    TAILOR_SDK_TOKEN_RE.test(text) &&
    !isSplitPackageFlagValue(elements, index, source, start)
  );
}

function packageRunnerCommandIndex(
  elements: SgNode[],
  start: number,
  source: string,
): number | null {
  for (let index = start; index < elements.length; index += 1) {
    const value = sourceStringContent(elements[index]!, source);
    if (value == null) return null;
    if (SOURCE_PACKAGE_FLAG_RE.test(value)) {
      if (!value.includes("=")) index += 1;
      continue;
    }
    if (value.startsWith("-")) {
      if (skipsRunnerOptionValue(value)) index += 1;
      continue;
    }
    return index;
  }
  return null;
}

function isPackageManagerExecBinaryArgument(node: SgNode, source: string): boolean {
  const parent = node.parent();
  if (parent?.kind() !== "array") return false;

  const argumentsNode = parent.parent();
  if (argumentsNode?.kind() !== "arguments") return false;
  const callee = callExpressionCalleeText(argumentsNode);
  if (!CLI_ARGUMENT_CALLEE_RE.test(callee ?? "")) return false;

  const callArgs = sourceArrayElements(argumentsNode);
  const executableNode = callArgs[0];
  if (executableNode == null) return false;
  const executable = sourceStringContent(executableNode, source);
  if (executable == null || !SOURCE_EXEC_PACKAGE_MANAGERS.has(executable)) return false;

  const elements = sourceArrayElements(parent);
  const index = nodeIndex(elements, node);
  if (index < 0) return false;

  const execIndex = firstNonOptionIndex(elements, 0, source);
  if (execIndex == null || sourceStringContent(elements[execIndex]!, source) !== "exec") {
    return false;
  }
  return (
    firstNonOptionIndex(elements, execIndex + 1, source) === index &&
    !arrayHasCliRenameLegacyArgs(elements, index + 1, source)
  );
}

function isCliBinaryArgument(node: SgNode, source: string): boolean {
  const parent = node.parent();
  if (parent?.kind() === "array") {
    if (isPackageRunnerCommandBinaryArgument(node, source)) return true;
    if (isPackageRunnerArrayArgument(node, source)) return false;
    return isPackageManagerExecBinaryArgument(node, source);
  }

  if (parent?.kind() !== "arguments") return false;
  if (!CLI_ARGUMENT_CALLEE_RE.test(callExpressionCalleeText(parent) ?? "")) return false;
  const args = sourceArrayElements(parent);
  if (args[0] == null || nodeRangeKey(args[0]) !== nodeRangeKey(node)) return false;
  const argv = args[1];
  return (
    argv?.kind() !== "array" || !arrayHasCliRenameLegacyArgs(sourceArrayElements(argv), 0, source)
  );
}

function arrayHasCliRenameLegacyArgs(elements: SgNode[], start: number, source: string): boolean {
  for (let index = start; index < elements.length; index += 1) {
    const value = sourceStringContent(elements[index]!, source);
    if (value == null) continue;
    if (TAILOR_CLI_VALUE_FLAGS.has(value.split("=", 1)[0]!) && !value.includes("=")) {
      index += 1;
      continue;
    }
    if (value === "apply" || value === "crash-report") return true;
    if (value === "--machineuser" || value.startsWith("--machineuser=")) return true;
  }
  return false;
}

function isTailorCliArgumentArray(arrayNode: SgNode, index: number, source: string): boolean {
  const argumentsNode = arrayNode.parent();
  if (argumentsNode?.kind() === "arguments") {
    const callArgs = sourceArrayElements(argumentsNode);
    const executable = callArgs[0] == null ? null : sourceStringContent(callArgs[0]!, source);
    if (executable != null && TAILOR_CLI_TOKEN_RE.test(executable)) return true;
  }

  const elements = sourceArrayElements(arrayNode);
  return elements.slice(0, index).some((element) => {
    const value = sourceStringContent(element, source);
    return value != null && TAILOR_CLI_TOKEN_RE.test(value);
  });
}

function isCliValueArgument(node: SgNode, source: string): boolean {
  const parent = node.parent();
  if (parent?.kind() !== "array") return false;
  const elements = sourceArrayElements(parent);
  const index = nodeIndex(elements, node);
  if (index < 0) return false;
  if (!isTailorCliArgumentArray(parent, index, source)) return false;
  const text = sourceStringContent(node, source) ?? sourceStringRawContent(node, source);
  if (
    text != null &&
    text.includes("tailor-sdk") &&
    isTailorCliValueFlag(text) &&
    text.includes("=")
  ) {
    return true;
  }
  if (index === 0) return false;
  const previousValue = sourceStringContent(elements[index - 1]!, source);
  return (
    text != null &&
    text.includes("tailor-sdk") &&
    previousValue != null &&
    isTailorCliValueFlag(previousValue) &&
    !previousValue.includes("=")
  );
}

function pushSourceStringEdit(
  edits: Array<[number, number, string]>,
  source: string,
  node: SgNode,
): void {
  const range = node.range();
  const start = range.start.index + 1;
  const end = range.end.index - 1;
  const text = source.slice(start, end);
  const packageFlagReplacement = sourcePackageFlagReplacement(node, source);
  const replacement =
    packageFlagReplacement != null
      ? packageFlagReplacement.replacement
      : TAILOR_SDK_TOKEN_RE.test(text) && isPackageRunnerPackageArgument(node, source)
        ? renamePackageName(text)
        : (TAILOR_SDK_TOKEN_RE.test(text) || TAILOR_SDK_PATH_RE.test(text)) &&
            isCliBinaryArgument(node, source)
          ? renameBinary(text)
          : isCliValueArgument(node, source)
            ? text
            : renameSourceCommandText(text);
  if (replacement !== text) {
    edits.push([start, end, replacement]);
  }
}

function templateSubstitutionPlaceholder(
  index: number,
  text: string,
  usedPlaceholders: Set<string>,
): string {
  let attempt = 0;
  while (true) {
    const placeholder = `__TAILOR_SDK_TEMPLATE_EXPR_${index}_${attempt}__`;
    if (!text.includes(placeholder) && !usedPlaceholders.has(placeholder)) {
      usedPlaceholders.add(placeholder);
      return placeholder;
    }
    attempt += 1;
  }
}

function pushTemplateStringEdit(
  edits: Array<[number, number, string]>,
  source: string,
  node: SgNode,
): void {
  const range = node.range();
  const start = range.start.index + 1;
  const end = range.end.index - 1;
  let text = source.slice(start, end);
  const substitutions: Array<{ placeholder: string; text: string }> = [];
  const usedPlaceholders = new Set<string>();

  const substitutionNodes = node
    .children()
    .filter((child: SgNode) => child.kind() === "template_substitution");
  for (const child of substitutionNodes.toReversed()) {
    const childRange = child.range();
    const childStart = childRange.start.index - start;
    const childEnd = childRange.end.index - start;
    const placeholder = templateSubstitutionPlaceholder(
      substitutions.length,
      text,
      usedPlaceholders,
    );
    substitutions.push({
      placeholder,
      text: isTemplateSubstitutionCliValue(text, childStart)
        ? source.slice(childRange.start.index, childRange.end.index)
        : transformTemplateSubstitutionText(
            source.slice(childRange.start.index, childRange.end.index),
          ),
    });
    text = `${text.slice(0, childStart)}${placeholder}${text.slice(childEnd)}`;
  }

  let replacement = renameSourceCommandText(text);
  for (const substitution of substitutions) {
    replacement = replacement.replaceAll(substitution.placeholder, substitution.text);
  }
  if (replacement !== source.slice(start, end)) {
    edits.push([start, end, replacement]);
  }
}

function transformTemplateSubstitutionText(value: string): string {
  if (!value.includes("tailor-sdk") || !value.startsWith("${") || !value.endsWith("}")) {
    return value;
  }
  const expression = value.slice(2, -1);
  const transformed = transformSourceFile(expression, "template-expression.ts");
  return transformed == null ? value : `\${${transformed}}`;
}

function transformSourceFile(source: string, filePath: string): string | null {
  let root: SgNode;
  try {
    root = parse(sourceLang(filePath), source).root();
  } catch {
    return null;
  }

  const edits: Array<[number, number, string]> = [];
  const visit = (node: SgNode): void => {
    const kind = node.kind();
    const range = node.range();

    if (kind === "comment" || kind === "jsx_text" || kind === "string_fragment") {
      pushSourceTextEdit(edits, source, range.start.index, range.end.index);
      return;
    }

    if (kind === "string") {
      pushSourceStringEdit(edits, source, node);
      return;
    }

    if (kind === "template_string") {
      const hasSubstitution = node
        .children()
        .some((child: SgNode) => child.kind() === "template_substitution");
      if (!hasSubstitution) {
        pushSourceStringEdit(edits, source, node);
        return;
      }
      if (isCliValueArgument(node, source)) return;
      pushTemplateStringEdit(edits, source, node);
      return;
    }

    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(root);

  if (edits.length === 0) return null;
  let updated = source;
  for (const [start, end, replacement] of edits.toSorted(([a], [b]) => b - a)) {
    updated = `${updated.slice(0, start)}${replacement}${updated.slice(end)}`;
  }
  return updated === source ? null : updated;
}

function transformPackageJson(source: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }

  let modified = false;
  const scripts = parsed.scripts;
  if (typeof scripts === "object" && scripts != null && !Array.isArray(scripts)) {
    for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      if (!value.includes("tailor-sdk")) continue;
      const updated = renameBinary(value);
      if (updated !== value) {
        (scripts as Record<string, string>)[name] = updated;
        modified = true;
      }
    }
  }

  if (!modified) return null;
  const trailing = source.endsWith("\n") ? "\n" : "";
  return JSON.stringify(parsed, null, 2) + trailing;
}

/**
 * Rename `tailor-sdk` binary references to `tailor`.
 *
 * Handles optional `@version` pins:
 * - `npx tailor-sdk@latest` → `npx @tailor-platform/sdk@latest` (package-runner form)
 * - `npx -y tailor-sdk login` → `npx -y @tailor-platform/sdk login` (runner flags preserved)
 * - `pnpm dlx tailor-sdk@latest` → `pnpm dlx @tailor-platform/sdk@latest` (package-runner form)
 * - `tailor-sdk@latest` elsewhere → `@tailor-platform/sdk@latest`
 * Does not rewrite `.tailor-sdk` directory paths or `create-tailor-sdk`.
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!source.includes("tailor-sdk")) return null;

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  if (SOURCE_EXTENSIONS.has(ext)) return transformSourceFile(source, filePath);

  const updated = renameBinary(source);
  return updated === source ? null : updated;
}
