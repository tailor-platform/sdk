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
  "(?:--env-file-if-exists|--env-file|--profile|--config|--workspace-id|--arg|--query|--file|-e|-p|-c|-w|-a|-q|-f)";
const TAILOR_CLI_VALUE_FLAGS = new Set([
  "--env-file-if-exists",
  "--env-file",
  "--profile",
  "--config",
  "--workspace-id",
  "--arg",
  "--query",
  "--file",
  "-e",
  "-p",
  "-c",
  "-w",
  "-a",
  "-q",
  "-f",
]);
const SOURCE_ESCAPED_QUOTED_VALUE = String.raw`\\"(?:\\\\.|[^"\\])*\\"|\\'(?:\\\\.|[^'\\])*\\'`;
const SOURCE_CLI_ARG_VALUE = `(?:${SOURCE_ESCAPED_QUOTED_VALUE}|${SOURCE_ARG_VALUE})`;
const SOURCE_COMMAND_GAP = `(?:\\s+--?[\\w-]+(?:=${SOURCE_CLI_ARG_VALUE})?(?:\\s+${SOURCE_CLI_ARG_VALUE})?)*`;
const SOURCE_RUNNER_OPTION_GAP = `(?:\\s+(?:-\\w+|--\\w[\\w-]*)(?:=${SOURCE_ARG_VALUE})?(?:\\s+(?!tailor-sdk(?![\\w-])|-)${SOURCE_ARG_VALUE})?)*`;
const SOURCE_CLI_VALUE_REFERENCE_RE = new RegExp(
  `(${TAILOR_CLI_VALUE_FLAG}(?:=|\\s+))(${SOURCE_CLI_ARG_VALUE})`,
  "g",
);
const SOURCE_TEMPLATE_EXPR_PLACEHOLDER = "__TAILOR_SDK_TEMPLATE_EXPR_\\d+__";
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
const SOURCE_NPX_PACKAGE_FLAG_VALUE_RE = new RegExp(
  `\\b(npx(?:(?!\\s+(?:-p|--package)(?:=|\\s+))\\s+${SOURCE_ARG_VALUE})*\\s+(?:-p|--package)(?:=|\\s+))tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?(?=${SOURCE_PKG_RUNNER_INVOCATION_LOOKAHEAD})`,
  "g",
);
const SOURCE_NPX_PACKAGE_FLAG_BINARY_RE = new RegExp(
  `\\b(npx(?:(?!\\s+tailor-sdk(?![\\w-])(?:@[^\\s'"\`;|&)]+)?${SOURCE_PKG_RUNNER_COMMAND_LOOKAHEAD})\\s+${SOURCE_ARG_VALUE})*\\s+)tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?(?=${SOURCE_PKG_RUNNER_COMMAND_LOOKAHEAD})`,
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
const SOURCE_TOKEN_RE = new RegExp(SOURCE_ARG_VALUE, "g");
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

function protectSourceCliValueReferences(value: string): {
  source: string;
  protectedValues: string[];
} {
  const protectedValues: string[] = [];
  const source = value.replace(
    SOURCE_CLI_VALUE_REFERENCE_RE,
    (match: string, prefix: string, arg: string, offset: number) => {
      if (!arg.includes("tailor-sdk")) return match;
      if (!isAfterTailorCliToken(value, offset)) return match;
      if (prefix.startsWith("-p") && NPX_PACKAGE_FLAG_CONTEXT_RE.test(value.slice(0, offset))) {
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

function sourceTokens(value: string): string[] | null {
  const tokens: string[] = [];
  SOURCE_TOKEN_RE.lastIndex = 0;
  let lastEnd = 0;
  for (const match of value.matchAll(SOURCE_TOKEN_RE)) {
    if (value.slice(lastEnd, match.index).trim() !== "") return null;
    tokens.push(match[0]);
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  return value.slice(lastEnd).trim() === "" ? tokens : null;
}

function skipsRunnerOptionValue(token: string): boolean {
  return RUNNER_OPTION_VALUE_FLAGS.has(token.split("=", 1)[0]!) && !token.includes("=");
}

function firstRunnerPackageToken(tokens: string[]): string | null {
  const executable = tokens[0];
  let index: number;
  if (executable === "npx" || executable === "bunx") {
    index = 1;
  } else if (executable === "pnpm" || executable === "yarn") {
    index = 1;
    for (; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token === "dlx") {
        index += 1;
        break;
      }
      if (token.startsWith("-")) {
        if (skipsRunnerOptionValue(token)) index += 1;
        continue;
      }
      return null;
    }
  } else {
    return null;
  }

  for (; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.startsWith("-")) {
      if (skipsRunnerOptionValue(token)) index += 1;
      continue;
    }
    return token;
  }
  return null;
}

function isAfterOtherPackageRunner(source: string, offset: number): boolean {
  const segmentStart = Math.max(
    source.lastIndexOf(";", offset - 1),
    source.lastIndexOf("&", offset - 1),
    source.lastIndexOf("|", offset - 1),
  );
  const segment = source.slice(segmentStart + 1, offset).trim();
  const tokens = sourceTokens(segment);
  if (tokens == null) return false;
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
  return tokens != null && tokens.some((token) => /^__TAILOR_SDK_TEMPLATE_EXPR_\d+__$/.test(token));
}

function renameSourceCommandText(value: string): string {
  const protectedValue = protectSourceCliValueReferences(value);
  const withPackageFlagValues = protectedValue.source.replace(
    SOURCE_NPX_PACKAGE_FLAG_VALUE_RE,
    (_match, prefix: string, version?: string) =>
      version ? `${prefix}@tailor-platform/sdk${version}` : `${prefix}@tailor-platform/sdk`,
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
    SOURCE_NPX_PACKAGE_FLAG_BINARY_RE,
    (match: string, prefix: string, version?: string) => {
      if (!/\s(?:-p|--package)(?:=|\s)/.test(prefix)) return match;
      if (/(?:^|\s)(?:-p|--package)\s+$/.test(prefix)) return match;
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
  return TAILOR_CLI_VALUE_FLAGS.has(value.split("=", 1)[0]!);
}

function hasNpxPackageFlagBefore(elements: SgNode[], index: number, source: string): boolean {
  return elements.some((element, currentIndex) => {
    if (currentIndex >= index) return false;
    const value = sourceStringContent(element, source);
    return value != null && SOURCE_PACKAGE_FLAG_RE.test(value);
  });
}

function isNpxSplitPackageFlagValue(elements: SgNode[], index: number, source: string): boolean {
  const previous = elements[index - 1];
  if (previous == null) return false;
  const previousValue = sourceStringContent(previous, source);
  return previousValue === "-p" || previousValue === "--package";
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

  if (hasNpxPackageFlagBefore(elements, index, source)) {
    return isNpxSplitPackageFlagValue(elements, index, source);
  }

  if (SOURCE_PACKAGE_RUNNERS.has(executable)) {
    return firstTailorPackageIndex(elements, 0, source) === index;
  }

  if (SOURCE_DLX_PACKAGE_RUNNERS.has(executable)) {
    const dlxIndex = firstNonOptionIndex(elements, 0, source);
    if (dlxIndex == null || sourceStringContent(elements[dlxIndex]!, source) !== "dlx") {
      return false;
    }
    return firstTailorPackageIndex(elements, dlxIndex + 1, source) === index;
  }

  return false;
}

function isPackageRunnerCommandBinaryArgument(node: SgNode, source: string): boolean {
  const parent = node.parent();
  if (parent?.kind() !== "array" || !isPackageRunnerArrayArgument(node, source)) return false;

  const elements = sourceArrayElements(parent);
  const index = nodeIndex(elements, node);
  if (index < 0 || !hasNpxPackageFlagBefore(elements, index, source)) return false;

  const text = sourceStringContent(node, source);
  return (
    text != null &&
    TAILOR_SDK_TOKEN_RE.test(text) &&
    !isNpxSplitPackageFlagValue(elements, index, source)
  );
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
  return firstNonOptionIndex(elements, execIndex + 1, source) === index;
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
  return args[0] != null && nodeRangeKey(args[0]) === nodeRangeKey(node);
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
  const text = sourceStringContent(node, source);
  if (text != null && isTailorCliValueFlag(text) && text.includes("=")) return true;
  if (index === 0) return false;
  const previousValue = sourceStringContent(elements[index - 1]!, source);
  return (
    previousValue != null && isTailorCliValueFlag(previousValue) && !previousValue.includes("=")
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
        : isCliValueArgument(node, source)
          ? text
          : TAILOR_SDK_TOKEN_RE.test(text) && isCliBinaryArgument(node, source)
            ? renameBinary(text)
            : renameSourceCommandText(text);
  if (replacement !== text) {
    edits.push([start, end, replacement]);
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

  const substitutionNodes = node
    .children()
    .filter((child: SgNode) => child.kind() === "template_substitution");
  for (const child of substitutionNodes.toReversed()) {
    const childRange = child.range();
    const childStart = childRange.start.index - start;
    const childEnd = childRange.end.index - start;
    const placeholder = `__TAILOR_SDK_TEMPLATE_EXPR_${substitutions.length}__`;
    substitutions.push({
      placeholder,
      text: transformTemplateSubstitutionText(
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
