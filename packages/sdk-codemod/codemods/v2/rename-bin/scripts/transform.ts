import { parse, Lang } from "@ast-grep/napi";
import * as path from "pathe";
import type { SgNode } from "@ast-grep/napi";

const SHELL_ARG_VALUE = `(?:[^\\s'"\`;|&]+|'[^']*'|"(?:(?:\\\\.)|[^"\\\\])*")`;
const RUNNER_VALUE_FLAG = "(?:--cache|--userconfig|--registry|--prefix|--dir|--filter|--cwd|-C)";
const RUNNER_VALUE_ARG = `${RUNNER_VALUE_FLAG}(?:=${SHELL_ARG_VALUE}|\\s+${SHELL_ARG_VALUE})`;
const RUNNER_BOOLEAN_ARG = `(?:(?!-p(?:\\s|$))-\\w+|--(?!package(?:=|\\s|$))\\w[\\w-]*(?:=${SHELL_ARG_VALUE})?)`;
const RUNNER_OPTION = `(?:${RUNNER_VALUE_ARG}|${RUNNER_BOOLEAN_ARG})`;
const DIRECT_PKG_RUNNER = `(?:npx|bunx)(?:\\s+${RUNNER_OPTION})*`;
const DLX_PKG_RUNNER = `(?:pnpm|yarn)(?:\\s+${RUNNER_OPTION})*\\s+dlx(?:\\s+${RUNNER_OPTION})*`;

// Package-runner forms resolve npm package names, so `tailor-sdk@...` must
// become `@tailor-platform/sdk@...`; rewriting to `tailor@...` would download
// the unrelated CSS Sprites Generator instead. Runner options, including
// options with values, are captured as part of the runner group.
const PKG_RUNNER_RE = new RegExp(
  `\\b((?:${DIRECT_PKG_RUNNER}|${DLX_PKG_RUNNER}))\\s+tailor-sdk(?![\\w-])(@[^\\s'"\`;|&)]+)?`,
  "g",
);
const PACKAGE_RUNNER_EXECUTABLE_PREFIX_RE = new RegExp(
  `(?:^|[;&|\n\`])\\s*(?:env\\s+)?(?:[A-Za-z_]\\w*=${SHELL_ARG_VALUE}\\s+)*(?:${DIRECT_PKG_RUNNER}|${DLX_PKG_RUNNER})\\s+(?:["'])?$`,
);
const RUNNER_VALUE_REFERENCE_RE = new RegExp(
  `(${RUNNER_VALUE_FLAG}(?:=|\\s+))(${SHELL_ARG_VALUE})`,
  "g",
);
const RUNNER_PACKAGE_VALUE_REFERENCE_RE = new RegExp(
  `\\b((?:${DIRECT_PKG_RUNNER}|${DLX_PKG_RUNNER})\\s+(?:--package|-p)(?:=|\\s+))(${SHELL_ARG_VALUE})`,
  "g",
);
const TAILOR_CLI_VALUE_FLAG =
  "(?:--env-file-if-exists|--env-file|--profile|--config|--workspace-id|--arg|--query|--file|-e|-p|-c|-w|-a|-q|-f)";
const TAILOR_CLI_VALUE_REFERENCE_RE = new RegExp(
  `(${TAILOR_CLI_VALUE_FLAG}(?:=|\\s+))(${SHELL_ARG_VALUE})`,
  "g",
);

// Match the `tailor-sdk` binary, optionally with a version pin (`@latest`,
// `@2.0.0`, etc.). Lookbehind excludes `.tailor-sdk` (preceded by `.`) and
// `create-tailor-sdk` (preceded by `-`). Lookahead excludes trailing `-word`
// (e.g. `tailor-sdk-skills`) to avoid partial-match rewrites.
const TAILOR_SDK_RE = /(?<![.\w-])tailor-sdk(?![\w-])(@[^\s'"`;|&)]+)?/g;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const TAILOR_SDK_TOKEN = /^tailor-sdk(@[^\s'"`;|&)]+)?$/;
const TAILOR_SDK_COMMAND_TOKEN_RE =
  /(?<![=.\w-])tailor-sdk(?![\w-])(?:@[^\s'"`;|&)]+)?\s+([^\s'"`;|&)]+)/g;
const TAILOR_CLI_COMMANDS = new Set([
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
]);
const TAILOR_CLI_SEPARATE_VALUE_FLAGS = new Set([
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
const TAILOR_CLI_GLOBAL_FLAGS = new Set([
  "--env-file-if-exists",
  "--env-file",
  "--profile",
  "--config",
  "--workspace-id",
  "--verbose",
  "--json",
  "--yes",
  "--help",
  "--version",
  "-e",
  "-p",
  "-c",
  "-w",
  "-j",
  "-y",
  "-h",
  "-v",
]);
const SOURCE_STRING_WRAPPER_NODE_KINDS = new Set([
  "as_expression",
  "non_null_expression",
  "parenthesized_expression",
  "satisfies_expression",
  "type_assertion",
]);
const CLI_ARGUMENT_CALLEE_RE = /(?:^|\.)(?:spawn|spawnSync|execFile|execFileSync|execa|execaSync)$/;

type RunnerState =
  | "none"
  | "await-dlx"
  | "await-dlx-flag-value"
  | "await-executable"
  | "await-executable-flag-value"
  | "await-package"
  | "await-package-option-value"
  | "await-flag-value";

interface SourceStringToken {
  value: string;
  start: number;
  end: number;
}

interface TextRange {
  start: number;
  end: number;
}

interface TemplateToken {
  value: string;
  segments: SourceStringToken[];
  substitutions: SgNode[];
  quoted: boolean;
}

interface TemplateTokenState {
  quote: "'" | '"' | null;
  token: TemplateToken | null;
}

interface TokenizedRunnerRewrite {
  source: string;
  protectedValues: string[];
}

const TEMPLATE_SUBSTITUTION_PLACEHOLDER = "\u{E000}";

function renameBinary(value: string): string {
  const packageValueUpdated = rewriteRunnerPackageValueReferences(value);
  const protectedRunnerValue = protectShellRunnerValueReferences(packageValueUpdated);
  const protectedCliValue = protectTailorCliValueReferences(protectedRunnerValue.source);
  const withRunners = protectedCliValue.source.replace(
    PKG_RUNNER_RE,
    (_, runner: string, version?: string) =>
      version ? `${runner} @tailor-platform/sdk${version}` : `${runner} @tailor-platform/sdk`,
  );
  const updated = withRunners.replace(TAILOR_SDK_RE, (_match, version?: string) =>
    version ? `@tailor-platform/sdk${version}` : "tailor",
  );
  const cliValueRestored = restoreProtectedValues(
    updated,
    protectedCliValue.protectedValues,
    "__TAILOR_SDK_CODEMOD_CLI_VALUE_",
  );
  return restoreProtectedValues(
    cliValueRestored,
    protectedRunnerValue.protectedValues,
    "__TAILOR_SDK_CODEMOD_SHELL_VALUE_",
  );
}

function sourceLang(filePath: string): Lang {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".tsx" || ext === ".jsx" || ext === ".js" ? Lang.Tsx : Lang.TypeScript;
}

function isTokenSequenceNode(node: SgNode): boolean {
  return node.kind() === "array" || isCliArgumentsNode(node);
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

function isProtectedRunnerValuePlaceholder(node: SgNode): boolean {
  return /^__TAILOR_SDK_CODEMOD_VALUE_PROTECTED_\d+__$/.test(node.text());
}

function nodeRangeKey(node: SgNode): string {
  const range = node.range();
  return `${range.start.index}:${range.end.index}`;
}

function isCliArgumentsNode(node: SgNode): boolean {
  if (node.kind() !== "arguments") return false;
  const parent = node.parent();
  if (parent?.kind() !== "call_expression") return false;
  const argumentRange = nodeRangeKey(node);
  const callee = parent.children().find((child: SgNode) => nodeRangeKey(child) !== argumentRange);
  const calleeText = callee?.text();
  return calleeText === "$" || (calleeText != null && CLI_ARGUMENT_CALLEE_RE.test(calleeText));
}

function sourceStringToken(node: SgNode, source: string): SourceStringToken | undefined {
  const kind = node.kind();
  if (kind !== "string" && kind !== "template_string") return undefined;
  if (
    kind === "template_string" &&
    node.children().some((child: SgNode) => child.kind() === "template_substitution")
  ) {
    return undefined;
  }

  const range = node.range();
  return {
    value: source.slice(range.start.index + 1, range.end.index - 1),
    start: range.start.index + 1,
    end: range.end.index - 1,
  };
}

function ensureTemplateToken(state: TemplateTokenState): TemplateToken {
  state.token ??= { value: "", segments: [], substitutions: [], quoted: false };
  return state.token;
}

function appendTemplateTokenChar(state: TemplateTokenState, ch: string, sourceIndex: number): void {
  const token = ensureTemplateToken(state);
  token.value += ch;
  const previous = token.segments.at(-1);
  if (previous && previous.end === sourceIndex) {
    previous.value += ch;
    previous.end += 1;
  } else {
    token.segments.push({ value: ch, start: sourceIndex, end: sourceIndex + 1 });
  }
}

function pushTemplateToken(tokens: TemplateToken[], state: TemplateTokenState): void {
  if (!state.token) return;
  tokens.push(state.token);
  state.token = null;
}

function scanTemplateTextTokens(
  state: TemplateTokenState,
  text: string,
  offset: number,
  tokens: TemplateToken[],
): void {
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;

    if (state.quote !== null) {
      appendTemplateTokenChar(state, ch, offset + index);
      if (ch === "\\" && state.quote === '"' && index + 1 < text.length) {
        index += 1;
        appendTemplateTokenChar(state, text[index]!, offset + index);
        continue;
      }
      if (ch === state.quote) {
        state.quote = null;
      }
      continue;
    }

    if (/\s/.test(ch)) {
      pushTemplateToken(tokens, state);
      continue;
    }

    appendTemplateTokenChar(state, ch, offset + index);
    if (ch === "'" || ch === '"') {
      state.quote = ch;
      ensureTemplateToken(state).quoted = true;
    }
  }
}

function appendTemplateSubstitution(state: TemplateTokenState, substitution: SgNode): void {
  const token = ensureTemplateToken(state);
  token.value += TEMPLATE_SUBSTITUTION_PLACEHOLDER;
  token.substitutions.push(substitution);
}

function collectTemplateTokens(node: SgNode, source: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  const state: TemplateTokenState = { quote: null, token: null };

  for (const child of node.children()) {
    if (child.kind() === "string_fragment") {
      const range = child.range();
      scanTemplateTextTokens(
        state,
        source.slice(range.start.index, range.end.index),
        range.start.index,
        tokens,
      );
      continue;
    }
    if (child.kind() === "template_substitution") {
      appendTemplateSubstitution(state, child);
    }
  }

  pushTemplateToken(tokens, state);
  return tokens;
}

function staticTemplateTokenValue(token: TemplateToken): string | undefined {
  return token.substitutions.length === 0 ? token.value : undefined;
}

function isRunnerFlag(value: string): boolean {
  if (isRunnerPackageFlag(value)) return false;
  return /^-\w+$|^--\w[\w-]*(?:=.*)?$/.test(value);
}

function isRunnerValueFlag(value: string): boolean {
  return /^(?:--cache|--userconfig|--registry|--prefix|--dir|--filter|--cwd|-C)(?:=|$)/.test(value);
}

function isRunnerOpenValueFlag(value: string): boolean {
  return isRunnerValueFlag(value) && (!value.includes("=") || value.endsWith("="));
}

function isRunnerSeparateValueFlag(value: string | undefined): boolean {
  return (
    value === "--cache" ||
    value === "--userconfig" ||
    value === "--registry" ||
    value === "--prefix" ||
    value === "--dir" ||
    value === "--filter" ||
    value === "--cwd" ||
    value === "-C"
  );
}

function isRunnerPackageFlag(value: string): boolean {
  return /^(?:--package|-p)(?:=|$)/.test(value);
}

function isRunnerOpenPackageFlag(value: string): boolean {
  return isRunnerPackageFlag(value) && (!value.includes("=") || value.endsWith("="));
}

function isRunnerSeparatePackageFlag(value: string | undefined): boolean {
  return value === "--package" || value === "-p";
}

function rewriteRunnerPackageOptionValue(
  token: SourceStringToken,
): Array<[number, number, string]> {
  const equalsIndex = token.value.indexOf("=");
  if (equalsIndex === -1) return [];
  const value = token.value.slice(equalsIndex + 1);
  const replacement = rewriteRunnerPackageValue(value);
  return replacement ? [[token.start + equalsIndex + 1, token.end, replacement]] : [];
}

function restoreProtectedValues(source: string, protectedValues: string[], prefix: string): string {
  let restored = source;
  for (const [index, value] of protectedValues.entries()) {
    restored = restored.replaceAll(`${prefix}${index}__`, value);
  }
  return restored;
}

function protectShellRunnerValueReferences(source: string): TokenizedRunnerRewrite {
  const protectedValues: string[] = [];
  const updated = source.replace(
    RUNNER_VALUE_REFERENCE_RE,
    (match, prefix: string, value: string) => {
      if (!value.includes("tailor-sdk")) return match;
      const placeholder = `__TAILOR_SDK_CODEMOD_SHELL_VALUE_${protectedValues.length}__`;
      protectedValues.push(value);
      return `${prefix}${placeholder}`;
    },
  );
  return { source: updated, protectedValues };
}

function protectTailorCliValueReferences(source: string): TokenizedRunnerRewrite {
  const protectedValues: string[] = [];
  const updated = source.replace(
    TAILOR_CLI_VALUE_REFERENCE_RE,
    (match, prefix: string, value: string, offset: number) => {
      if (!value.includes("tailor-sdk")) return match;
      if (isPackageRunnerExecutableReference(source, offset + prefix.length)) return match;
      const placeholder = `__TAILOR_SDK_CODEMOD_CLI_VALUE_${protectedValues.length}__`;
      protectedValues.push(value);
      return `${prefix}${placeholder}`;
    },
  );
  return { source: updated, protectedValues };
}

function isPackageRunnerExecutableReference(source: string, start: number): boolean {
  return PACKAGE_RUNNER_EXECUTABLE_PREFIX_RE.test(source.slice(0, start));
}

function rewriteRunnerPackageValue(value: string): string | undefined {
  const quote = value[0] === "'" || value[0] === '"' ? value[0] : "";
  const inner = quote ? value.slice(1, -1) : value;
  const replacement = runnerPackageReplacement(inner);
  if (!replacement) return undefined;
  return quote ? `${quote}${replacement}${quote}` : replacement;
}

function rewriteRunnerPackageValueReferences(source: string): string {
  return source.replace(
    RUNNER_PACKAGE_VALUE_REFERENCE_RE,
    (match, prefix: string, value: string) => {
      const replacement = rewriteRunnerPackageValue(value);
      return replacement ? `${prefix}${replacement}` : match;
    },
  );
}

function runnerStateAfterToken(value: string): RunnerState {
  if (value === "npx" || value === "bunx") return "await-package";
  if (value === "pnpm" || value === "yarn") return "await-dlx";
  return "none";
}

function runnerPackageReplacement(value: string): string | undefined {
  const match = TAILOR_SDK_TOKEN.exec(value);
  if (!match) return undefined;
  return `@tailor-platform/sdk${match[1] ?? ""}`;
}

function isPathLikeRunnerFlagValue(value: string): boolean {
  return value.startsWith(".") || value.startsWith("/") || value.startsWith("~");
}

function isTailorCliCommandToken(value: string): boolean {
  const token = value.replace(/[),.:!?]+$/, "");
  return TAILOR_CLI_COMMANDS.has(token) || isTailorCliGlobalFlag(token);
}

function optionName(value: string): string {
  const equalsIndex = value.indexOf("=");
  return equalsIndex === -1 ? value : value.slice(0, equalsIndex);
}

function isTailorCliGlobalFlag(value: string): boolean {
  return TAILOR_CLI_GLOBAL_FLAGS.has(optionName(value));
}

function tailorCliValueFlagName(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  return Array.from(TAILOR_CLI_SEPARATE_VALUE_FLAGS).find(
    (flag) => value === flag || value.startsWith(`${flag}=`),
  );
}

function isOpenTailorCliValueFlag(value: string | undefined): boolean {
  const flag = tailorCliValueFlagName(value);
  return flag != null && (value === flag || value === `${flag}=`);
}

function hasInlineTailorCliValue(value: string | undefined): boolean {
  const flag = tailorCliValueFlagName(value);
  return (
    flag != null && value != null && value.startsWith(`${flag}=`) && value.length > flag.length + 1
  );
}

function isLikelyDynamicTailorArgvRemainder(node: SgNode): boolean {
  if (node.kind() === "spread_element") return true;
  return /\b(?:argv|args?|cmd|command|subcommand)\b/i.test(node.text());
}

function collectPackageRunnerTokenRanges(value: string): TextRange[] {
  const ranges: TextRange[] = [];
  PKG_RUNNER_RE.lastIndex = 0;
  for (;;) {
    const match = PKG_RUNNER_RE.exec(value);
    if (!match) break;
    const tokenStartInMatch = match[0].lastIndexOf("tailor-sdk");
    if (tokenStartInMatch === -1) continue;
    const start = match.index + tokenStartInMatch;
    ranges.push({ start, end: start + "tailor-sdk".length + (match[2]?.length ?? 0) });
  }
  PKG_RUNNER_RE.lastIndex = 0;
  return ranges;
}

function collectPackageRunnerOptionValueRanges(value: string): TextRange[] {
  const ranges: TextRange[] = [];
  RUNNER_PACKAGE_VALUE_REFERENCE_RE.lastIndex = 0;
  for (;;) {
    const match = RUNNER_PACKAGE_VALUE_REFERENCE_RE.exec(value);
    if (!match) break;
    const optionValue = match[2]!;
    if (!rewriteRunnerPackageValue(optionValue)) continue;
    const quoteOffset = optionValue[0] === "'" || optionValue[0] === '"' ? 1 : 0;
    const start = match.index + match[1]!.length + quoteOffset;
    ranges.push({ start, end: start + optionValue.length - quoteOffset * 2 });
  }
  RUNNER_PACKAGE_VALUE_REFERENCE_RE.lastIndex = 0;
  return ranges;
}

function collectTailorCommandTokenRanges(value: string): TextRange[] {
  const ranges: TextRange[] = [];
  TAILOR_SDK_COMMAND_TOKEN_RE.lastIndex = 0;
  for (;;) {
    const match = TAILOR_SDK_COMMAND_TOKEN_RE.exec(value);
    if (!match) break;
    if (!isTailorCliCommandToken(match[1]!)) {
      TAILOR_SDK_COMMAND_TOKEN_RE.lastIndex = match.index + 1;
      continue;
    }
    const token = /^tailor-sdk(@[^\s'"`;|&)]+)?/.exec(match[0]);
    if (!token) continue;
    ranges.push({ start: match.index, end: match.index + token[0].length });
  }
  TAILOR_SDK_COMMAND_TOKEN_RE.lastIndex = 0;
  return ranges;
}

function collectDynamicTemplateTailorCommandRanges(value: string): TextRange[] {
  const ranges: TextRange[] = [];
  const commandBoundary = String.raw`(?:^|[;&|\n])\s*`;
  const shellPrefix = String.raw`(?:(?:env\s+)?(?:[A-Za-z_]\w*=${SHELL_ARG_VALUE}\s+)*)`;
  const tailorToken = "tailor-sdk(?:@[^\\s'\"`;|&)]+)?";
  const patterns = [
    new RegExp(`${commandBoundary}${shellPrefix}${tailorToken}(?=\\s|$)`, "gu"),
    new RegExp(
      `${commandBoundary}${shellPrefix}(?:pnpm|yarn)(?:\\s+${RUNNER_OPTION})*\\s+exec(?:\\s+${RUNNER_OPTION})*\\s+${tailorToken}(?=\\s|$)`,
      "gu",
    ),
    new RegExp(
      `${commandBoundary}${shellPrefix}(?:pnpm|yarn)(?:\\s+${RUNNER_OPTION})*\\s+${tailorToken}(?=\\s|$)`,
      "gu",
    ),
    new RegExp(
      `${commandBoundary}${shellPrefix}(?:npx|bunx)(?:\\s+${RUNNER_OPTION})*\\s+(?:--package|-p)(?:=${SHELL_ARG_VALUE}|\\s+${SHELL_ARG_VALUE})(?:\\s+${RUNNER_OPTION})*\\s+${tailorToken}(?=\\s|$)`,
      "gu",
    ),
  ];
  for (const pattern of patterns) {
    for (;;) {
      const match = pattern.exec(value);
      if (!match) break;
      const tokenStartInMatch = match[0].lastIndexOf("tailor-sdk");
      if (tokenStartInMatch === -1) continue;
      const version = /^tailor-sdk(@[^\s'"`;|&)]+)?/.exec(match[0].slice(tokenStartInMatch))?.[1];
      const start = match.index + tokenStartInMatch;
      ranges.push({ start, end: start + "tailor-sdk".length + (version?.length ?? 0) });
    }
  }
  return ranges;
}

function collectRewriteableTailorSdkRanges(value: string): TextRange[] {
  return [
    ...collectPackageRunnerTokenRanges(value),
    ...collectPackageRunnerOptionValueRanges(value),
    ...collectTailorCommandTokenRanges(value),
  ];
}

function containsRange(ranges: TextRange[], start: number, end: number): boolean {
  return ranges.some((range) => range.start <= start && end <= range.end);
}

function collectNonCommandTailorSdkRanges(
  value: string,
  offset: number,
  rewriteableRanges = collectRewriteableTailorSdkRanges(value),
  rewriteableOffset = 0,
): Array<[number, number, string]> {
  const protectedRanges: Array<[number, number, string]> = [];
  TAILOR_SDK_RE.lastIndex = 0;
  for (;;) {
    const match = TAILOR_SDK_RE.exec(value);
    if (!match) break;
    const start = match.index;
    const end = start + match[0].length;
    if (!containsRange(rewriteableRanges, rewriteableOffset + start, rewriteableOffset + end)) {
      protectedRanges.push([offset + start, offset + end, match[0]]);
    }
  }
  TAILOR_SDK_RE.lastIndex = 0;
  return protectedRanges;
}

function runnerPackageExpressionChildren(node: SgNode): SgNode[] {
  if (node.kind() === "parenthesized_expression") return node.children();
  if (node.kind() === "ternary_expression") return node.children().slice(1);
  if (node.kind() === "binary_expression" && /&&|\|\|/.test(node.text())) {
    return node.children().slice(1);
  }
  return [];
}

function collectTokenizedRunnerEdits(
  root: SgNode,
  source: string,
): { edits: Array<[number, number, string]>; protectedRanges: Array<[number, number, string]> } {
  const edits: Array<[number, number, string]> = [];
  const protectedRanges: Array<[number, number, string]> = [];

  const protectToken = (token: SourceStringToken): void => {
    if (token.value.includes("tailor-sdk")) {
      protectedRanges.push([token.start, token.end, token.value]);
    }
  };

  const protectTemplateToken = (token: TemplateToken): void => {
    for (const segment of token.segments) {
      protectToken(segment);
    }
    for (const substitution of token.substitutions) {
      protectTailorSdkStrings(substitution);
    }
  };

  const pushTemplateTokenReplacement = (token: TemplateToken, replacement: string): void => {
    if (token.segments.length !== 1) return;
    const [{ start, end }] = token.segments;
    edits.push([start, end, replacement]);
  };

  const collectTemplatePackageExpressionEdits = (token: TemplateToken): boolean => {
    let changed = false;
    for (const substitution of token.substitutions) {
      changed = collectPackageExpressionEdits(substitution) || changed;
    }
    return changed;
  };

  const protectTailorSdkStrings = (node: SgNode): void => {
    const token = sourceStringToken(node, source);
    if (token) {
      protectToken(token);
      return;
    }
    for (const child of node.children()) {
      protectTailorSdkStrings(child);
    }
  };

  const collectPackageExpressionEdits = (node: SgNode): boolean => {
    const token = sourceStringToken(node, source);
    if (token) {
      const replacement = runnerPackageReplacement(token.value);
      if (replacement) {
        edits.push([token.start, token.end, replacement]);
        return true;
      }
      return false;
    }
    let changed = false;
    const packageChildren = runnerPackageExpressionChildren(node);
    if (packageChildren.length > 0) {
      const packageChildRanges = new Set(packageChildren.map((child) => nodeRangeKey(child)));
      for (const child of node.children()) {
        if (!packageChildRanges.has(nodeRangeKey(child))) {
          protectTailorSdkStrings(child);
        }
      }
    }
    const children = packageChildren.length > 0 ? packageChildren : node.children();
    for (const child of children) {
      changed = collectPackageExpressionEdits(child) || changed;
    }
    return changed;
  };

  const expressionStringValues = (node: SgNode): string[] => {
    const token = sourceStringToken(node, source);
    if (token) return [token.value];
    const values: string[] = [];
    const packageChildren = runnerPackageExpressionChildren(node);
    const children = packageChildren.length > 0 ? packageChildren : node.children();
    for (const child of children) {
      values.push(...expressionStringValues(child));
    }
    return values;
  };

  const dynamicRunnerOptionState = (node: SgNode): RunnerState | null => {
    const values = expressionStringValues(node)
      .map((value) => value.trim())
      .filter((value) => value !== "");
    if (values.length === 0) return null;
    if (values.every((value) => isRunnerOpenPackageFlag(value))) {
      return "await-package-option-value";
    }
    if (!values.every((value) => isRunnerFlag(value) || isRunnerValueFlag(value))) return null;
    const hasOpenValueFlag = values.some((value) => isRunnerOpenValueFlag(value));
    if (hasOpenValueFlag) {
      return "await-flag-value";
    }
    return "await-package";
  };

  const dynamicRunnerOptionStateFor = (
    runnerState: RunnerState,
    node: SgNode,
  ): RunnerState | null => {
    const dynamicState = dynamicRunnerOptionState(node);
    if (runnerState === "await-executable") {
      if (dynamicState === "await-flag-value") return "await-executable-flag-value";
      if (dynamicState === "await-package") return "await-executable";
      return dynamicState;
    }
    if (runnerState !== "await-dlx") return dynamicState;
    if (dynamicState === "await-flag-value") return "await-dlx-flag-value";
    if (dynamicState === "await-package") return "await-dlx";
    return dynamicState;
  };

  const advanceRunnerState = (runnerState: RunnerState, value: string): RunnerState => {
    if (runnerState === "await-flag-value") return "await-package";
    if (runnerState === "await-dlx-flag-value") return "await-dlx";
    if (runnerState === "await-executable-flag-value") return "await-executable";
    if (runnerState === "await-package-option-value") return "await-executable";

    if (runnerState === "await-executable") {
      if (isRunnerSeparatePackageFlag(value)) return "await-package-option-value";
      if (isRunnerPackageFlag(value)) {
        return isRunnerOpenPackageFlag(value) ? "await-package-option-value" : "await-executable";
      }
      if (isRunnerSeparateValueFlag(value)) return "await-executable-flag-value";
      if (isRunnerValueFlag(value)) {
        return value.includes("=") && !value.endsWith("=")
          ? "await-executable"
          : "await-executable-flag-value";
      }
      if (isRunnerFlag(value)) return "await-executable";
      return "none";
    }

    if (runnerState === "await-dlx") {
      if (value === "dlx") return "await-package";
      if (isRunnerSeparateValueFlag(value)) return "await-dlx-flag-value";
      if (isRunnerValueFlag(value)) {
        return value.includes("=") && !value.endsWith("=") ? "await-dlx" : "await-dlx-flag-value";
      }
      if (isRunnerFlag(value)) return "await-dlx";
      return runnerStateAfterToken(value);
    }

    if (runnerState === "await-package") {
      if (isRunnerSeparatePackageFlag(value)) return "await-package-option-value";
      if (isRunnerPackageFlag(value)) {
        return isRunnerOpenPackageFlag(value) ? "await-package-option-value" : "await-executable";
      }
      if (isRunnerSeparateValueFlag(value)) return "await-flag-value";
      if (isRunnerValueFlag(value)) {
        return value.includes("=") && !value.endsWith("=") ? "await-package" : "await-flag-value";
      }
      if (isRunnerFlag(value)) return "await-package";
      return "none";
    }

    return runnerStateAfterToken(value);
  };

  const processRunnerTemplateToken = (
    runnerState: RunnerState,
    token: TemplateToken,
  ): RunnerState => {
    const nextState = runnerState;
    const value = staticTemplateTokenValue(token);

    if (nextState === "await-flag-value") {
      protectTemplateToken(token);
      return "await-package";
    }
    if (nextState === "await-dlx-flag-value") {
      protectTemplateToken(token);
      return "await-dlx";
    }
    if (nextState === "await-package-option-value") {
      if (value !== undefined) {
        const replacement = rewriteRunnerPackageValue(value);
        if (replacement) {
          pushTemplateTokenReplacement(token, replacement);
        }
      } else {
        collectTemplatePackageExpressionEdits(token);
      }
      return "await-executable";
    }
    if (nextState === "await-package") {
      if (value !== undefined) {
        if (isRunnerPackageFlag(value)) {
          for (const segment of token.segments) {
            edits.push(...rewriteRunnerPackageOptionValue(segment));
          }
          return isRunnerOpenPackageFlag(value) ? "await-package-option-value" : "await-executable";
        }
        if (isRunnerFlag(value) || isRunnerValueFlag(value)) {
          if (isRunnerValueFlag(value) && value.includes("=")) {
            protectTemplateToken(token);
          }
          return advanceRunnerState(nextState, value);
        }
        const replacement = rewriteRunnerPackageValue(value);
        if (replacement) {
          pushTemplateTokenReplacement(token, replacement);
        }
        return "none";
      }

      if (isRunnerPackageFlag(token.value)) {
        collectTemplatePackageExpressionEdits(token);
        return isRunnerOpenPackageFlag(token.value)
          ? "await-package-option-value"
          : "await-executable";
      }
      if (isRunnerValueFlag(token.value)) {
        protectTemplateToken(token);
        return token.value.includes("=") && !token.value.endsWith("=")
          ? "await-package"
          : "await-flag-value";
      }
      if (isRunnerFlag(token.value)) {
        return "await-package";
      }
      const changed = collectTemplatePackageExpressionEdits(token);
      return changed ? "none" : (dynamicRunnerOptionState(token.substitutions[0]!) ?? "none");
    }

    if (nextState === "await-executable") {
      if (value !== undefined) {
        if (isRunnerPackageFlag(value)) {
          for (const segment of token.segments) {
            edits.push(...rewriteRunnerPackageOptionValue(segment));
          }
          return isRunnerOpenPackageFlag(value) ? "await-package-option-value" : "await-executable";
        }
        if (isRunnerValueFlag(value)) {
          if (value.includes("=")) {
            protectTemplateToken(token);
          }
          return value.includes("=") && !value.endsWith("=")
            ? "await-executable"
            : "await-executable-flag-value";
        }
        if (isRunnerFlag(value)) return "await-executable";
        if (TAILOR_SDK_TOKEN.test(value)) {
          pushTemplateTokenReplacement(token, "tailor");
        }
        return "none";
      }

      if (isRunnerPackageFlag(token.value)) {
        collectTemplatePackageExpressionEdits(token);
        return isRunnerOpenPackageFlag(token.value)
          ? "await-package-option-value"
          : "await-executable";
      }
      if (isRunnerValueFlag(token.value)) {
        protectTemplateToken(token);
        return token.value.includes("=") && !token.value.endsWith("=")
          ? "await-executable"
          : "await-executable-flag-value";
      }
      if (isRunnerFlag(token.value)) return "await-executable";
      return dynamicRunnerOptionStateFor("await-executable", token.substitutions[0]!) ?? "none";
    }

    if (nextState === "await-executable-flag-value") {
      protectTemplateToken(token);
      return "await-executable";
    }

    if (nextState === "await-dlx" && value === undefined) {
      return dynamicRunnerOptionStateFor(nextState, token.substitutions[0]!) ?? "none";
    }

    if (value !== undefined) {
      return advanceRunnerState(nextState, value);
    }
    return dynamicRunnerOptionStateFor(nextState, token.substitutions[0]!) ?? "none";
  };

  const visitTemplate = (node: SgNode, inheritedRunnerState: RunnerState): RunnerState => {
    let runnerState = inheritedRunnerState;
    for (const token of collectTemplateTokens(node, source)) {
      if (token.substitutions.length === 0) {
        runnerState = processRunnerTemplateToken(runnerState, token);
        continue;
      }

      if (
        runnerState === "await-package" ||
        runnerState === "await-package-option-value" ||
        runnerState === "await-flag-value" ||
        runnerState === "await-executable" ||
        runnerState === "await-executable-flag-value" ||
        runnerState === "await-dlx" ||
        runnerState === "await-dlx-flag-value"
      ) {
        runnerState = processRunnerTemplateToken(runnerState, token);
        continue;
      }

      for (const substitution of token.substitutions) {
        visit(substitution);
      }
      const dynamicState = dynamicRunnerOptionStateFor(runnerState, token.substitutions[0]!);
      if (dynamicState) {
        runnerState = dynamicState;
      } else {
        const value = staticTemplateTokenValue(token);
        if (value !== undefined) {
          runnerState = advanceRunnerState(runnerState, value);
        }
      }
    }
    return runnerState;
  };

  const visit = (node: SgNode, inheritedRunnerState: RunnerState = "none"): void => {
    if (inheritedRunnerState === "await-package") {
      const token = sourceStringToken(node, source);
      if (token) {
        const replacement = runnerPackageReplacement(token.value);
        if (replacement) {
          edits.push([token.start, token.end, replacement]);
        }
        return;
      }

      const packageChildren = runnerPackageExpressionChildren(node);
      if (packageChildren.length > 0) {
        for (const child of packageChildren) {
          visit(child, "await-package");
        }
        return;
      }
    }

    if (node.kind() === "template_string") {
      visitTemplate(node, inheritedRunnerState);
      return;
    }

    if (isTokenSequenceNode(node)) {
      let runnerState = inheritedRunnerState;
      let previousTokenValue: string | undefined;
      for (const child of node.children()) {
        const token = sourceStringToken(child, source);
        if (token) {
          const previous = previousTokenValue;
          previousTokenValue = token.value;

          if (runnerState === "await-flag-value") {
            protectToken(token);
            runnerState = "await-package";
            continue;
          }

          if (runnerState === "await-dlx-flag-value") {
            protectToken(token);
            runnerState = "await-dlx";
            continue;
          }

          if (runnerState === "await-executable-flag-value") {
            protectToken(token);
            runnerState = "await-executable";
            continue;
          }

          if (runnerState === "await-package-option-value") {
            const replacement = rewriteRunnerPackageValue(token.value);
            if (replacement) {
              edits.push([token.start, token.end, replacement]);
            }
            runnerState = "await-executable";
            previousTokenValue = undefined;
            continue;
          }

          if (runnerState === "await-executable") {
            if (isRunnerSeparatePackageFlag(token.value)) {
              runnerState = "await-package-option-value";
              continue;
            }
            if (isRunnerPackageFlag(token.value)) {
              edits.push(...rewriteRunnerPackageOptionValue(token));
              runnerState = isRunnerOpenPackageFlag(token.value)
                ? "await-package-option-value"
                : "await-executable";
              continue;
            }
            if (isRunnerSeparateValueFlag(previous)) {
              protectToken(token);
              continue;
            }
            if (isRunnerSeparateValueFlag(token.value)) {
              runnerState = "await-executable-flag-value";
              continue;
            }
            if (isRunnerValueFlag(token.value)) {
              if (token.value.includes("=")) {
                protectToken(token);
              }
              runnerState = token.value.includes("=")
                ? "await-executable"
                : "await-executable-flag-value";
              continue;
            }
            if (isRunnerFlag(token.value)) continue;
            if (TAILOR_SDK_TOKEN.test(token.value)) {
              edits.push([token.start, token.end, "tailor"]);
            } else if (isPathLikeRunnerFlagValue(token.value)) {
              protectToken(token);
            }
            runnerState = "none";
            continue;
          }

          if (runnerState === "await-dlx") {
            if (token.value === "dlx") {
              runnerState = "await-package";
              continue;
            }
            if (isRunnerSeparateValueFlag(token.value)) {
              runnerState = "await-dlx-flag-value";
              continue;
            }
            if (isRunnerValueFlag(token.value)) {
              if (token.value.includes("=")) {
                protectToken(token);
              }
              continue;
            }
            if (isRunnerFlag(token.value)) continue;
            runnerState = runnerStateAfterToken(token.value);
            continue;
          }

          if (runnerState === "await-package") {
            if (isRunnerSeparatePackageFlag(token.value)) {
              runnerState = "await-package-option-value";
              continue;
            }
            if (isRunnerPackageFlag(token.value)) {
              edits.push(...rewriteRunnerPackageOptionValue(token));
              runnerState = isRunnerOpenPackageFlag(token.value)
                ? "await-package-option-value"
                : "await-executable";
              continue;
            }
            if (isRunnerSeparateValueFlag(previous)) {
              protectToken(token);
              continue;
            }
            if (isRunnerSeparateValueFlag(token.value)) {
              runnerState = "await-flag-value";
              continue;
            }
            if (isRunnerValueFlag(token.value)) {
              if (token.value.includes("=")) {
                protectToken(token);
              }
              runnerState = token.value.includes("=") ? "await-package" : "await-flag-value";
              continue;
            }
            if (isRunnerFlag(token.value)) continue;
            const replacement = runnerPackageReplacement(token.value);
            if (replacement) {
              edits.push([token.start, token.end, replacement]);
            } else if (isPathLikeRunnerFlagValue(token.value)) {
              protectToken(token);
              runnerState = "none";
              continue;
            }
            runnerState = "none";
            continue;
          }

          runnerState = runnerStateAfterToken(token.value);
          continue;
        }

        if (isSyntaxOnlyNode(child)) {
          visit(child);
          continue;
        }

        if (
          (runnerState === "await-package" || runnerState === "await-dlx") &&
          runnerPackageExpressionChildren(child).length > 0
        ) {
          const changed = collectPackageExpressionEdits(child);
          runnerState = changed
            ? "none"
            : (dynamicRunnerOptionStateFor(runnerState, child) ?? "none");
          continue;
        }

        if (
          (runnerState === "await-package" || runnerState === "await-dlx") &&
          child.kind() === "spread_element"
        ) {
          runnerState = dynamicRunnerOptionStateFor(runnerState, child) ?? runnerState;
          previousTokenValue = undefined;
          continue;
        }

        if (runnerState === "await-flag-value") {
          protectTailorSdkStrings(child);
          runnerState = "await-package";
          previousTokenValue = undefined;
          continue;
        }

        if (runnerState === "await-package-option-value") {
          collectPackageExpressionEdits(child);
          runnerState = "await-executable";
          previousTokenValue = undefined;
          continue;
        }

        if (runnerState === "await-executable-flag-value") {
          protectTailorSdkStrings(child);
          runnerState = "await-executable";
          previousTokenValue = undefined;
          continue;
        }

        if (child.kind() === "template_string") {
          runnerState = visitTemplate(child, runnerState);
          previousTokenValue = undefined;
          continue;
        }

        if (runnerState === "await-dlx-flag-value") {
          protectTailorSdkStrings(child);
          runnerState = "await-dlx";
          previousTokenValue = undefined;
          continue;
        }

        if (runnerState === "await-package" && isProtectedRunnerValuePlaceholder(child)) {
          continue;
        }

        if (runnerState === "await-executable") {
          visit(
            child,
            isTokenSequenceNode(child) || child.kind() === "template_string" ? runnerState : "none",
          );
          runnerState = "none";
          previousTokenValue = undefined;
          continue;
        }

        if (runnerState === "await-package") {
          visit(child, isTokenSequenceNode(child) ? runnerState : "none");
          runnerState = "none";
          previousTokenValue = undefined;
          continue;
        }

        visit(
          child,
          isTokenSequenceNode(child) || child.kind() === "template_string" ? runnerState : "none",
        );
      }
      return;
    }

    for (const child of node.children()) {
      visit(child);
    }
  };

  visit(root);
  return { edits, protectedRanges };
}

function rewriteTokenizedPackageRunners(source: string, filePath: string): TokenizedRunnerRewrite {
  let root: SgNode;
  try {
    root = parse(sourceLang(filePath), source).root();
  } catch {
    return { source, protectedValues: [] };
  }

  let updated = source;
  const { edits, protectedRanges } = collectTokenizedRunnerEdits(root, source);
  const protectedValues: string[] = [];
  const protectionEdits = protectedRanges.map(([start, end, value], index) => {
    protectedValues.push(value);
    return [start, end, `__TAILOR_SDK_CODEMOD_PROTECTED_${index}__`] as [number, number, string];
  });
  const editByRange = new Map<string, [number, number, string]>();
  for (const edit of [...edits, ...protectionEdits]) {
    editByRange.set(`${edit[0]}:${edit[1]}`, edit);
  }
  const allEdits = Array.from(editByRange.values()).toSorted(([a], [b]) => b - a);
  for (const [start, end, replacement] of allEdits) {
    updated = `${updated.slice(0, start)}${replacement}${updated.slice(end)}`;
  }
  return { source: updated, protectedValues };
}

function protectRunnerValueStrings(source: string): TokenizedRunnerRewrite {
  const protectedValues: string[] = [];
  const protectValueToken = (match: string, valueQuote: string, value: string): string => {
    const placeholder = `__TAILOR_SDK_CODEMOD_VALUE_PROTECTED_${protectedValues.length}__`;
    protectedValues.push(value);
    return match.replace(
      `${valueQuote}${value}${valueQuote}`,
      `${valueQuote}${placeholder}${valueQuote}`,
    );
  };
  const inlineProtected = source.replace(
    /(["'`])((?:--cache|--userconfig|--registry|--prefix|--dir|--filter|--cwd|-C)=)([^"'`]*tailor-sdk[^"'`]*)\1/g,
    (match, quote: string, prefix: string, value: string) => {
      const placeholder = `__TAILOR_SDK_CODEMOD_VALUE_PROTECTED_${protectedValues.length}__`;
      protectedValues.push(value);
      return `${quote}${prefix}${placeholder}${quote}`;
    },
  );
  const updated = inlineProtected.replace(
    /(["'])(?:--cache|--userconfig|--registry|--prefix|--dir|--filter|--cwd|-C)\1\s*,\s*(["'`])([^"'`]*tailor-sdk[^"'`]*)\2/g,
    (match, _flagQuote: string, valueQuote: string, value: string) => {
      return protectValueToken(match, valueQuote, value);
    },
  );
  return { source: updated, protectedValues };
}

function protectStandaloneTailorSdkSourceStrings(
  source: string,
  filePath: string,
): TokenizedRunnerRewrite {
  let root: SgNode;
  try {
    root = parse(sourceLang(filePath), source).root();
  } catch {
    return { source, protectedValues: [] };
  }

  const ranges: Array<[number, number, string]> = [];
  const isSourceStringWrapperNode = (node: SgNode): boolean => {
    return SOURCE_STRING_WRAPPER_NODE_KINDS.has(node.kind());
  };
  const sourceStringExpressionToken = (
    node: SgNode,
    visited = new Set<string>(),
  ): SourceStringToken | undefined => {
    const direct = sourceStringToken(node, source);
    if (direct) return direct;
    if (!isSourceStringWrapperNode(node)) return undefined;
    const key = nodeRangeKey(node);
    if (visited.has(key)) return undefined;
    visited.add(key);
    for (const child of node.children()) {
      const token = sourceStringExpressionToken(child, visited);
      if (token) return token;
    }
    return undefined;
  };
  const arrayElementForSourceString = (node: SgNode): SgNode | undefined => {
    let element = node;
    let parent = element.parent();
    while (parent && isSourceStringWrapperNode(parent)) {
      element = parent;
      parent = element.parent();
    }
    return parent?.kind() === "array" ? element : undefined;
  };
  const isSingleElementArrayToken = (node: SgNode): boolean => {
    const element = arrayElementForSourceString(node) ?? node;
    const parent = element.parent();
    if (parent?.kind() !== "array") return false;
    return parent.children().filter((child: SgNode) => !isSyntaxOnlyNode(child)).length === 1;
  };
  const arrayElementNodes = (node: SgNode): SgNode[] => {
    return node.children().filter((child: SgNode) => !isSyntaxOnlyNode(child));
  };
  const arrayElementTokens = (node: SgNode): SourceStringToken[] => {
    return arrayElementNodes(node)
      .map((child: SgNode) => sourceStringExpressionToken(child))
      .filter((token): token is SourceStringToken => token != null);
  };
  const hasTailorCommandTokenPair = (tokens: SourceStringToken[]): boolean => {
    return tokens.some((token, index) => {
      const next = tokens[index + 1];
      return (
        TAILOR_SDK_TOKEN.test(token.value) && next != null && isTailorCliCommandToken(next.value)
      );
    });
  };
  const hasTailorPackageRunnerToken = (tokens: SourceStringToken[]): boolean => {
    let runnerState: RunnerState = "none";
    for (const token of tokens) {
      if (runnerState === "await-flag-value") {
        runnerState = "await-package";
        continue;
      }
      if (runnerState === "await-dlx-flag-value") {
        runnerState = "await-dlx";
        continue;
      }
      if (runnerState === "await-package-option-value") {
        if (runnerPackageReplacement(token.value)) return true;
        runnerState = "await-executable";
        continue;
      }
      if (runnerState === "await-executable") {
        if (isRunnerSeparatePackageFlag(token.value)) {
          runnerState = "await-package-option-value";
          continue;
        }
        if (isRunnerPackageFlag(token.value)) {
          if (rewriteRunnerPackageOptionValue(token).length > 0) return true;
          runnerState = isRunnerOpenPackageFlag(token.value)
            ? "await-package-option-value"
            : "await-executable";
          continue;
        }
        if (isRunnerSeparateValueFlag(token.value)) {
          runnerState = "await-executable-flag-value";
          continue;
        }
        if (isRunnerValueFlag(token.value) || isRunnerFlag(token.value)) continue;
        if (TAILOR_SDK_TOKEN.test(token.value)) return true;
        runnerState = "none";
        continue;
      }
      if (runnerState === "await-executable-flag-value") {
        runnerState = "await-executable";
        continue;
      }
      if (runnerState === "await-dlx") {
        if (token.value === "dlx") {
          runnerState = "await-package";
          continue;
        }
        if (isRunnerSeparateValueFlag(token.value)) {
          runnerState = "await-dlx-flag-value";
          continue;
        }
        if (isRunnerValueFlag(token.value) || isRunnerFlag(token.value)) continue;
        runnerState = runnerStateAfterToken(token.value);
        continue;
      }
      if (runnerState === "await-package") {
        if (isRunnerSeparatePackageFlag(token.value)) {
          runnerState = "await-package-option-value";
          continue;
        }
        if (isRunnerPackageFlag(token.value)) {
          if (rewriteRunnerPackageOptionValue(token).length > 0) return true;
          runnerState = isRunnerOpenPackageFlag(token.value)
            ? "await-package-option-value"
            : "await-executable";
          continue;
        }
        if (isRunnerSeparateValueFlag(token.value)) {
          runnerState = "await-flag-value";
          continue;
        }
        if (isRunnerValueFlag(token.value) || isRunnerFlag(token.value)) continue;
        if (runnerPackageReplacement(token.value)) return true;
        runnerState = "none";
        continue;
      }
      runnerState = runnerStateAfterToken(token.value);
    }
    return false;
  };
  const isTailorExecRunnerToken = (tokens: SourceStringToken[], tokenIndex: number): boolean => {
    const execIndex = tokens.findIndex((token) => token.value === "exec");
    if (execIndex === -1 || tokenIndex <= execIndex) return false;
    let expectFlagValue = false;
    for (let index = execIndex + 1; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (expectFlagValue) {
        expectFlagValue = false;
        continue;
      }
      if (isRunnerSeparateValueFlag(token.value)) {
        expectFlagValue = true;
        continue;
      }
      if (isRunnerValueFlag(token.value) || isRunnerFlag(token.value)) continue;
      return index === tokenIndex && TAILOR_SDK_TOKEN.test(token.value);
    }
    return false;
  };
  const hasTailorExecRunnerToken = (tokens: SourceStringToken[]): boolean => {
    return tokens.some((_, index) => isTailorExecRunnerToken(tokens, index));
  };
  const hasDynamicTailorArgvRemainder = (node: SgNode, tokens: SourceStringToken[]): boolean => {
    const [first] = tokens;
    if (!first || !TAILOR_SDK_TOKEN.test(first.value)) return false;
    if (node.parent()?.kind() === "array") return false;
    const firstElementIndex = arrayElementNodes(node).findIndex((child) => {
      const token = sourceStringExpressionToken(child);
      return token?.start === first.start && token.end === first.end;
    });
    if (firstElementIndex === -1) return false;
    return arrayElementNodes(node)
      .slice(firstElementIndex + 1)
      .some(
        (child) =>
          sourceStringToken(child, source) == null && isLikelyDynamicTailorArgvRemainder(child),
      );
  };
  const isRewriteableTailorArgvToken = (node: SgNode, token: SourceStringToken): boolean => {
    const element = arrayElementForSourceString(node);
    const parent = element?.parent();
    if (!element || parent?.kind() !== "array") return false;
    const tokens = arrayElementTokens(parent);
    const tokenIndex = tokens.findIndex(
      (candidate) => candidate.start === token.start && candidate.end === token.end,
    );
    if (tokenIndex === -1 || !TAILOR_SDK_TOKEN.test(token.value)) return false;
    if (isOpenTailorCliValueFlag(tokens[tokenIndex - 1]?.value)) return false;
    const next = tokens[tokenIndex + 1];
    if (next != null && isTailorCliCommandToken(next.value)) return true;
    if (tokenIndex === 0 && hasDynamicTailorArgvRemainder(parent, tokens)) return true;
    return isTailorExecRunnerToken(tokens, tokenIndex);
  };
  const isLikelyTailorArgvArray = (node: SgNode): boolean => {
    if (node.kind() !== "array") return false;
    const tokens = arrayElementTokens(node);
    const [first, second] = tokens;
    if (!first) return false;
    if (hasTailorPackageRunnerToken(tokens) || hasTailorCommandTokenPair(tokens)) return true;
    if (hasDynamicTailorArgvRemainder(node, tokens)) return true;
    if (first.value === "pnpm" || first.value === "yarn") {
      return hasTailorExecRunnerToken(tokens);
    }
    return (
      TAILOR_SDK_TOKEN.test(first.value) && second != null && isTailorCliCommandToken(second.value)
    );
  };
  const isProtectedArrayDataToken = (node: SgNode): boolean => {
    const element = arrayElementForSourceString(node) ?? node;
    const parent = element.parent();
    return parent?.kind() === "array" && !isLikelyTailorArgvArray(parent);
  };
  const sourceStringFragmentTokens = (node: SgNode): SourceStringToken[] => {
    return node
      .children()
      .filter((child: SgNode) => child.kind() === "string_fragment")
      .map((fragment: SgNode) => {
        const range = fragment.range();
        return {
          value: source.slice(range.start.index, range.end.index),
          start: range.start.index,
          end: range.end.index,
        };
      });
  };
  const protectNodeText = (node: SgNode): void => {
    const range = node.range();
    ranges.push([
      range.start.index,
      range.end.index,
      source.slice(range.start.index, range.end.index),
    ]);
  };
  const visitTokenSequence = (node: SgNode): void => {
    let afterTailorBinary = false;
    let skipNextTailorValue = false;

    for (const child of node.children()) {
      if (isSyntaxOnlyNode(child)) {
        visit(child);
        continue;
      }

      if (skipNextTailorValue) {
        if (child.text().includes("tailor-sdk")) {
          protectNodeText(child);
        }
        skipNextTailorValue = false;
        continue;
      }

      const token = sourceStringExpressionToken(child);
      if (token && !afterTailorBinary) {
        if (isRewriteableTailorArgvToken(child, token)) {
          afterTailorBinary = true;
        }
        visit(child);
        continue;
      }

      if (token && afterTailorBinary) {
        if (hasInlineTailorCliValue(token.value)) {
          if (token.value.includes("tailor-sdk")) {
            ranges.push([token.start, token.end, token.value]);
          }
          visit(child);
          continue;
        }
        if (isOpenTailorCliValueFlag(token.value)) {
          skipNextTailorValue = true;
          visit(child);
          continue;
        }
      }

      visit(child);
    }
  };
  const visit = (node: SgNode): void => {
    const kind = node.kind();
    if (isTokenSequenceNode(node)) {
      visitTokenSequence(node);
      return;
    }
    if (kind === "regex" && node.text().includes("tailor-sdk")) {
      protectNodeText(node);
      return;
    }
    if (kind === "comment" && node.text().includes("tailor-sdk")) {
      const range = node.range();
      ranges.push(...collectNonCommandTailorSdkRanges(node.text(), range.start.index));
      return;
    }
    if (kind === "jsx_text" && node.text().includes("tailor-sdk")) {
      const range = node.range();
      ranges.push(
        ...collectNonCommandTailorSdkRanges(
          source.slice(range.start.index, range.end.index),
          range.start.index,
        ),
      );
      return;
    }
    if (
      kind === "template_string" &&
      node.children().some((child: SgNode) => child.kind() === "template_substitution")
    ) {
      const fragments = sourceStringFragmentTokens(node);
      const staticText = fragments
        .map((fragment) => fragment.value)
        .join(TEMPLATE_SUBSTITUTION_PLACEHOLDER);
      if (fragments.some((fragment) => fragment.value.includes("tailor-sdk"))) {
        const rewriteableRanges = [
          ...collectRewriteableTailorSdkRanges(staticText),
          ...collectDynamicTemplateTailorCommandRanges(staticText),
        ];
        let fragmentOffset = 0;
        for (const fragment of fragments) {
          ranges.push(
            ...collectNonCommandTailorSdkRanges(
              fragment.value,
              fragment.start,
              rewriteableRanges,
              fragmentOffset,
            ),
          );
          fragmentOffset += fragment.value.length + TEMPLATE_SUBSTITUTION_PLACEHOLDER.length;
        }
      }
    }
    const token = sourceStringToken(node, source);
    if (token) {
      const parent = node.parent();
      const arrayElement = arrayElementForSourceString(node);
      const arrayParent = arrayElement?.parent();
      if (
        token.value.includes("tailor-sdk") &&
        (parent == null ||
          (!isTokenSequenceNode(parent) && arrayParent?.kind() !== "array") ||
          isSingleElementArrayToken(node) ||
          isProtectedArrayDataToken(node) ||
          (arrayParent?.kind() === "array" && !isRewriteableTailorArgvToken(node, token)))
      ) {
        ranges.push(...collectNonCommandTailorSdkRanges(token.value, token.start));
      }
      return;
    }
    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(root);

  let updated = source;
  const protectedValues: string[] = [];
  for (const [start, end, value] of ranges.toSorted(([a], [b]) => b - a)) {
    const placeholder = `__TAILOR_SDK_CODEMOD_STANDALONE_${protectedValues.length}__`;
    protectedValues.push(value);
    updated = `${updated.slice(0, start)}${placeholder}${updated.slice(end)}`;
  }
  return { source: updated, protectedValues };
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

  const valueProtected = SOURCE_EXTENSIONS.has(ext)
    ? protectRunnerValueStrings(source)
    : { source, protectedValues: [] };
  const tokenizedRunnerRewrite = SOURCE_EXTENSIONS.has(ext)
    ? rewriteTokenizedPackageRunners(valueProtected.source, filePath)
    : { source: valueProtected.source, protectedValues: [] };
  const standaloneProtected = SOURCE_EXTENSIONS.has(ext)
    ? protectStandaloneTailorSdkSourceStrings(tokenizedRunnerRewrite.source, filePath)
    : { source: tokenizedRunnerRewrite.source, protectedValues: [] };
  let updated = renameBinary(standaloneProtected.source);
  updated = restoreProtectedValues(
    updated,
    standaloneProtected.protectedValues,
    "__TAILOR_SDK_CODEMOD_STANDALONE_",
  );
  updated = restoreProtectedValues(
    updated,
    tokenizedRunnerRewrite.protectedValues,
    "__TAILOR_SDK_CODEMOD_PROTECTED_",
  );
  updated = restoreProtectedValues(
    updated,
    valueProtected.protectedValues,
    "__TAILOR_SDK_CODEMOD_VALUE_PROTECTED_",
  );
  return updated === source ? null : updated;
}
