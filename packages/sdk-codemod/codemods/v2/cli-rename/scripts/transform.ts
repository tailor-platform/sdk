import { parse, Lang } from "@ast-grep/napi";
import * as path from "pathe";
import type { SgNode } from "@ast-grep/napi";

// Map of v1 multi-word command names to their v2 single-word replacements.
const COMMAND_RENAMES: ReadonlyArray<readonly [string, string]> = [["crash-report", "crashreport"]];
const OPTION_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["--machineuser", "--machine-user"],
];

const ARG_VALUE = `(?:[^\\s'"\`;&|]+|'[^']*'|"(?:(?:\\\\.)|[^"\\\\])*")`;
const TAILOR_BINARY = `(?<![\\w-])tailor-sdk(?:@[^\\s'"\`]+)?(?![\\w-])`;
const TAILOR_BINARY_PATTERN = new RegExp(TAILOR_BINARY, "g");
const TAILOR_BINARY_START_PATTERN = new RegExp(`^${TAILOR_BINARY}`);
const PACKAGE_RUNNER_OPTION_VALUE_PREFIX_PATTERN = new RegExp(
  `(?:^|[;&|\n\`])\\s*(?:env\\s+)?(?:[A-Za-z_]\\w*=${ARG_VALUE}\\s+)*(?:npx|bunx|pnpm|yarn)(?:\\s+${ARG_VALUE})*\\s+(?:--package|-p|--cache|--userconfig|--registry|--prefix|--dir|--filter|--cwd|-C)(?:=|\\s+)(?:["'])?$`,
);
const SHELL_ASSIGNMENT_PREFIX_PATTERN = new RegExp(
  `^(?:env\\s+)?(?:[A-Za-z_]\\w*=${ARG_VALUE}\\s+)+${TAILOR_BINARY}(?=\\s|$)`,
);
const SHELL_SEPARATOR_TAILOR_PATTERN = new RegExp(`[;&|]\\s*${TAILOR_BINARY}(?=\\s|$)`);

const COMMAND_MAP = new Map(COMMAND_RENAMES);
const OPTION_MAP = new Map(OPTION_RENAMES);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const TAILOR_BINARY_TOKEN = /^tailor-sdk(?:@[^\s'"`;|&)]+)?$/;
const GLOBAL_BOOLEAN_ARGS = new Set(["--verbose", "--json", "--yes", "-j", "-y"]);
const GLOBAL_VALUE_ARGS = new Set([
  "--env-file",
  "--env-file-if-exists",
  "--profile",
  "--config",
  "--workspace-id",
  "-e",
  "-p",
  "-c",
  "-w",
]);
const COMMAND_VALUE_ARGS = [
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
] as const;
const CLI_VALUE_ARG_SET = new Set<string>(COMMAND_VALUE_ARGS);
const PACKAGE_RUNNER_VALUE_ARGS = new Set([
  "--cache",
  "--userconfig",
  "--registry",
  "--prefix",
  "--dir",
  "--filter",
  "--cwd",
  "-C",
]);
const CLI_ARGUMENT_CALLEE_RE = /(?:^|\.)(?:spawn|spawnSync|execFile|execFileSync|execa|execaSync)$/;

interface TextRange {
  start: number;
  end: number;
}

interface ActiveQuote {
  char: "'" | '"';
  escaped: boolean;
}

interface SourceStringToken {
  value: string;
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

interface CliTemplateState {
  afterTailorBinary: boolean;
  commandMayBeNext: boolean;
  skipNextValue: boolean;
}

interface CliTemplateEditResult {
  edits: Array<[number, number, string]>;
  protectedRanges: TextRange[];
}

const TEMPLATE_SUBSTITUTION_PLACEHOLDER = "\u{E000}";

function isOptionBoundaryChar(value: string | undefined): boolean {
  return value === undefined || !/[\w-]/.test(value);
}

function findInlineCodeSpanEnd(source: string, start: number): number | undefined {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const ticksBefore = [...source.slice(lineStart, start).matchAll(/`/g)].length;
  if (ticksBefore % 2 === 0) return undefined;

  const codeSpanEnd = source.indexOf("`", start);
  return codeSpanEnd === -1 ? undefined : codeSpanEnd;
}

function findEnclosingLineQuoteEnd(source: string, start: number): number | undefined {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = source.indexOf("\n", start);
  const limit = lineEnd === -1 ? source.length : lineEnd;
  let quote: "'" | '"' | null = null;

  for (let index = lineStart; index < start; index += 1) {
    const ch = source[index];
    if (quote !== null) {
      if (ch === "\\" && quote === '"' && index + 1 < start) {
        index += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    }
  }

  if (quote === null) return undefined;

  for (let index = start; index < limit; index += 1) {
    const ch = source[index];
    if (ch === "\\" && quote === '"' && index + 1 < limit) {
      index += 1;
      continue;
    }
    if (ch === quote) {
      return index;
    }
  }

  return undefined;
}

function lineIndent(line: string): number {
  const match = line.match(/^ */);
  return match?.[0].length ?? 0;
}

function isFoldedScalarHeader(line: string): boolean {
  return /^\s*(?:-\s*)?[^#\n]*:\s*>[+-]?(?:\s*(?:#.*)?)?$/.test(line);
}

function findFoldedYamlRanges(source: string): TextRange[] {
  const ranges: TextRange[] = [];
  const lines = source.match(/^.*(?:\n|$)/gm) ?? [];
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const body = line.replace(/\r?\n$/, "");
    offset += line.length;

    if (!isFoldedScalarHeader(body)) continue;

    const baseIndent = lineIndent(body);
    let rangeStart: number | undefined;
    let rangeEnd: number | undefined;
    let cursor = offset;

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex];
      const nextBody = nextLine.replace(/\r?\n$/, "");
      const trimmed = nextBody.trim();
      const indent = lineIndent(nextBody);

      if (trimmed !== "" && indent <= baseIndent) break;

      if (trimmed === "") {
        if (rangeStart !== undefined && rangeEnd !== undefined) {
          ranges.push({ start: rangeStart, end: rangeEnd });
          rangeStart = undefined;
          rangeEnd = undefined;
        }
      } else {
        rangeStart ??= cursor;
        rangeEnd = cursor + nextLine.length;
      }
      cursor += nextLine.length;
    }

    if (rangeStart !== undefined && rangeEnd !== undefined) {
      ranges.push({ start: rangeStart, end: rangeEnd });
    }
  }

  return ranges;
}

function findMarkdownFencedCodeRanges(source: string): TextRange[] {
  const ranges: TextRange[] = [];
  const lines = source.match(/^.*(?:\n|$)/gm) ?? [];
  let offset = 0;
  let open: { char: string; length: number; start: number } | undefined;

  for (const line of lines) {
    const body = line.replace(/\r?\n$/, "");
    const fenceBody = body.replace(/^ {0,3}\*\s?/, "");

    if (open) {
      const close = fenceBody.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      const marker = close?.[1];
      if (marker && marker[0] === open.char && marker.length >= open.length) {
        ranges.push({ start: open.start, end: offset });
        open = undefined;
      }
    } else {
      const start = fenceBody.match(/^ {0,3}(`{3,}|~{3,}).*$/);
      const marker = start?.[1];
      if (marker) {
        open = { char: marker[0], length: marker.length, start: offset + line.length };
      }
    }

    offset += line.length;
  }

  if (open) {
    ranges.push({ start: open.start, end: source.length });
  }

  return ranges;
}

function isCommandSeparator(source: string, index: number): boolean {
  const ch = source[index];
  const prev = source[index - 1];
  if (prev === "\\") return false;

  if (ch === "&") {
    const next = source[index + 1];
    if (prev === ">" || prev === "<" || next === ">") return false;
  }

  return ch === ";" || ch === "&" || ch === "|";
}

function startsCommandSubstitution(source: string, index: number): boolean {
  return source[index] === "$" && source[index + 1] === "(" && source[index - 1] !== "\\";
}

function startsTemplateSubstitution(source: string, index: number): boolean {
  return source[index] === "$" && source[index + 1] === "{" && source[index - 1] !== "\\";
}

function findCommandSubstitutionEnd(source: string, start: number): number | undefined {
  let depth = 1;
  let index = start + 2;
  let quote: ActiveQuote | null = null;

  while (index < source.length) {
    const ch = source[index];

    if (quote !== null) {
      if (quote.escaped) {
        if (ch === "\\" && source[index + 1] === quote.char) {
          quote = null;
          index += 2;
          continue;
        }
        index += 1;
        continue;
      }
      if (quote.char === '"' && startsCommandSubstitution(source, index)) {
        depth += 1;
        index += 2;
        continue;
      }
      if (ch === "\\" && quote.char === '"' && index + 1 < source.length) {
        index += 2;
        continue;
      }
      if (ch === quote.char) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (ch === "\\" && source[index + 1] === '"') {
      quote = { char: '"', escaped: true };
      index += 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = { char: ch, escaped: false };
      index += 1;
      continue;
    }

    if (startsCommandSubstitution(source, index)) {
      depth += 1;
      index += 2;
      continue;
    }

    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }

    index += 1;
  }

  return undefined;
}

function findTemplateSubstitutionEnd(source: string, start: number): number | undefined {
  let depth = 1;
  let index = start + 2;
  let quote: "'" | '"' | "`" | null = null;

  while (index < source.length) {
    const ch = source[index];

    if (quote !== null) {
      if (ch === "\\" && index + 1 < source.length) {
        index += 2;
        continue;
      }
      if (quote === "`" && startsTemplateSubstitution(source, index)) {
        const substitutionEnd = findTemplateSubstitutionEnd(source, index);
        if (substitutionEnd !== undefined) {
          index = substitutionEnd + 1;
          continue;
        }
      }
      if (ch === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      index += 1;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }

  return undefined;
}

function findContainingRange(
  ranges: TextRange[] | undefined,
  index: number,
): TextRange | undefined {
  return ranges?.find((range) => range.start <= index && index < range.end);
}

function findTailorCommandEnd(
  source: string,
  start: number,
  foldedYamlRanges?: TextRange[],
  markdownFencedCodeRanges?: TextRange[],
): number {
  const inlineCodeSpanEnd = findInlineCodeSpanEnd(source, start);
  const enclosingLineQuoteEnd = findEnclosingLineQuoteEnd(source, start);
  const limit = Math.min(
    inlineCodeSpanEnd ?? source.length,
    enclosingLineQuoteEnd ?? source.length,
  );
  const foldedYamlRange = findContainingRange(foldedYamlRanges, start);
  const markdownFencedCodeRange = findContainingRange(markdownFencedCodeRanges, start);
  const delimitedRange = foldedYamlRange ?? markdownFencedCodeRange;
  const commandLimit = delimitedRange ? Math.min(limit, delimitedRange.end) : limit;
  let quote: ActiveQuote | null = null;
  let end = start;

  while (end < commandLimit) {
    const ch = source[end];

    if (quote !== null) {
      if (quote.escaped) {
        if (ch === "\\" && source[end + 1] === quote.char) {
          quote = null;
          end += 2;
          continue;
        }
        end += 1;
        continue;
      }
      if (quote.char === '"' && startsCommandSubstitution(source, end)) {
        const substitutionEnd = findCommandSubstitutionEnd(source, end);
        if (substitutionEnd !== undefined) {
          end = substitutionEnd + 1;
          continue;
        }
      }
      if (ch === "\\" && quote.char === '"' && end + 1 < commandLimit) {
        end += 2;
        continue;
      }
      if (ch === quote.char) {
        quote = null;
      }
      end += 1;
      continue;
    }

    if (ch === "\\" && source[end + 1] === '"') {
      quote = { char: '"', escaped: true };
      end += 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = { char: ch, escaped: false };
      end += 1;
      continue;
    }

    if (startsCommandSubstitution(source, end)) {
      const substitutionEnd = findCommandSubstitutionEnd(source, end);
      if (substitutionEnd !== undefined) {
        end = substitutionEnd + 1;
        continue;
      }
    }

    const prev = source[end - 1];
    if (ch === ")") break;
    if (isCommandSeparator(source, end)) break;
    if (ch === "\n" && prev !== "\\" && !foldedYamlRange) break;
    end += 1;
  }
  return end;
}

function isDelimitedCommandContext(
  source: string,
  start: number,
  foldedYamlRanges?: TextRange[],
  markdownFencedCodeRanges?: TextRange[],
): boolean {
  return (
    findInlineCodeSpanEnd(source, start) !== undefined ||
    findEnclosingLineQuoteEnd(source, start) !== undefined ||
    findContainingRange(foldedYamlRanges, start) !== undefined ||
    findContainingRange(markdownFencedCodeRanges, start) !== undefined
  );
}

function findOptionRename(command: string, index: number): readonly [string, string] | undefined {
  return OPTION_RENAMES.find(
    ([from]) =>
      command.startsWith(from, index) &&
      command[index - 1] !== "=" &&
      isOptionBoundaryChar(command[index - 1]) &&
      isOptionBoundaryChar(command[index + from.length]),
  );
}

function findCliValueArg(command: string, index: number): string | undefined {
  return COMMAND_VALUE_ARGS.find(
    (arg) =>
      command.startsWith(arg, index) &&
      isOptionBoundaryChar(command[index - 1]) &&
      (command[index + arg.length] === "=" || isOptionBoundaryChar(command[index + arg.length])),
  );
}

function findShellArgEnd(command: string, start: number): number {
  let index = start;
  let quote: ActiveQuote | null = null;

  while (index < command.length) {
    const ch = command[index];
    if (quote !== null) {
      if (quote.escaped) {
        if (ch === "\\" && command[index + 1] === quote.char) {
          quote = null;
          index += 2;
          continue;
        }
      } else if (ch === "\\" && quote.char === '"' && index + 1 < command.length) {
        index += 2;
        continue;
      } else if (ch === quote.char) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = { char: ch, escaped: false };
      index += 1;
      continue;
    }
    if (ch === "\\" && (command[index + 1] === "'" || command[index + 1] === '"')) {
      quote = { char: command[index + 1] as "'" | '"', escaped: true };
      index += 2;
      continue;
    }
    if (startsCommandSubstitution(command, index)) {
      const substitutionEnd = findCommandSubstitutionEnd(command, index);
      if (substitutionEnd !== undefined) {
        index = substitutionEnd + 1;
        continue;
      }
    }
    if (startsTemplateSubstitution(command, index)) {
      const substitutionEnd = findTemplateSubstitutionEnd(command, index);
      if (substitutionEnd !== undefined) {
        index = substitutionEnd + 1;
        continue;
      }
    }
    if (/\s/.test(ch) || isCommandSeparator(command, index) || ch === ")") break;
    index += 1;
  }

  return index;
}

function replaceOptionsInCommand(command: string): string {
  let updated = "";
  let index = 0;
  let quote: ActiveQuote | null = null;

  while (index < command.length) {
    const ch = command[index];

    if (quote !== null) {
      if (quote.char === '"' && startsCommandSubstitution(command, index)) {
        const substitutionEnd = findCommandSubstitutionEnd(command, index);
        if (substitutionEnd !== undefined) {
          updated += "$(";
          updated += replaceAll(command.slice(index + 2, substitutionEnd));
          updated += ")";
          index = substitutionEnd + 1;
          continue;
        }
      }
      updated += ch;
      if (quote.escaped) {
        if (ch === "\\" && command[index + 1] === quote.char) {
          index += 1;
          updated += command[index];
          quote = null;
        }
      } else if (ch === "\\" && quote.char === '"' && index + 1 < command.length) {
        index += 1;
        updated += command[index];
      } else if (ch === quote.char) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (ch === "\\" && command[index + 1] === '"') {
      quote = { char: '"', escaped: true };
      updated += ch;
      index += 1;
      updated += command[index];
      index += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = { char: ch, escaped: false };
      updated += ch;
      index += 1;
      continue;
    }

    if (startsCommandSubstitution(command, index)) {
      const substitutionEnd = findCommandSubstitutionEnd(command, index);
      if (substitutionEnd !== undefined) {
        updated += "$(";
        updated += replaceAll(command.slice(index + 2, substitutionEnd));
        updated += ")";
        index = substitutionEnd + 1;
        continue;
      }
    }

    const valueArg = findCliValueArg(command, index);
    if (valueArg) {
      const afterName = index + valueArg.length;
      updated += command.slice(index, afterName);
      index = afterName;
      if (command[index] === "=") {
        const valueEnd = findShellArgEnd(command, index + 1);
        updated += command.slice(index, valueEnd);
        index = valueEnd;
        continue;
      }
      const whitespace = command.slice(index).match(/^\s+/)?.[0];
      if (whitespace) {
        updated += whitespace;
        index += whitespace.length;
        const valueEnd = findShellArgEnd(command, index);
        updated += command.slice(index, valueEnd);
        index = valueEnd;
      }
      continue;
    }

    const rename = findOptionRename(command, index);
    if (rename) {
      updated += rename[1];
      index += rename[0].length;
      if (command[index] === "=") {
        const valueEnd = findShellArgEnd(command, index + 1);
        updated += command.slice(index, valueEnd);
        index = valueEnd;
      }
      continue;
    }

    updated += ch;
    index += 1;
  }

  return updated;
}

function replaceCommandNameInCommand(command: string): string {
  const binary = command.match(TAILOR_BINARY_START_PATTERN)?.[0];
  if (!binary) return command;

  let index = binary.length;
  for (;;) {
    const whitespace = command.slice(index).match(/^\s+/)?.[0];
    if (whitespace) index += whitespace.length;
    if (index >= command.length) return command;

    const tokenEnd = findShellArgEnd(command, index);
    const token = command.slice(index, tokenEnd);
    const name = optionName(token);
    if (GLOBAL_BOOLEAN_ARGS.has(name)) {
      index = tokenEnd;
      continue;
    }
    if (isGlobalSeparateValueArg(name)) {
      index = tokenEnd;
      if (!token.includes("=") || token.endsWith("=")) {
        const valueWhitespace = command.slice(index).match(/^\s+/)?.[0];
        if (!valueWhitespace) return command;
        index += valueWhitespace.length;
        index = findShellArgEnd(command, index);
      }
      continue;
    }
    if (token.startsWith("-")) return command;

    const replacement = COMMAND_MAP.get(token);
    return replacement
      ? `${command.slice(0, index)}${replacement}${command.slice(tokenEnd)}`
      : command;
  }
}

function replaceCliRenamesInCommand(command: string): string {
  return replaceOptionsInCommand(replaceCommandNameInCommand(command));
}

function sourceLang(filePath: string): Lang {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".tsx" || ext === ".jsx" || ext === ".js" ? Lang.Tsx : Lang.TypeScript;
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

    if (isCommandSeparator(text, index)) {
      pushTemplateToken(tokens, state);
      appendTemplateTokenChar(state, ch, offset + index);
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

function pushTemplateTokenReplacement(
  edits: Array<[number, number, string]>,
  token: TemplateToken,
  replacement: string,
): void {
  if (token.segments.length !== 1) return;
  const [{ start, end }] = token.segments;
  edits.push([start, end, replacement]);
}

function optionName(value: string): string {
  const equalsIndex = value.indexOf("=");
  return equalsIndex === -1 ? value : value.slice(0, equalsIndex);
}

function isGlobalSeparateValueArg(value: string): boolean {
  return GLOBAL_VALUE_ARGS.has(value);
}

function isInlineGlobalValueArg(value: string): boolean {
  return isGlobalSeparateValueArg(optionName(value)) && value.includes("=") && !value.endsWith("=");
}

function isOpenGlobalValueArg(value: string): boolean {
  return (
    isGlobalSeparateValueArg(optionName(value)) && (!value.includes("=") || value.endsWith("="))
  );
}

function isAnySeparateValueArg(value: string): boolean {
  return CLI_VALUE_ARG_SET.has(value);
}

function isOpenCliValueArg(value: string): boolean {
  return isAnySeparateValueArg(optionName(value)) && (!value.includes("=") || value.endsWith("="));
}

function isInlineCliValueArg(value: string): boolean {
  return isAnySeparateValueArg(optionName(value)) && value.includes("=") && !value.endsWith("=");
}

function isPackageRunnerSeparatePackageArg(value: string | undefined): boolean {
  return value === "--package" || value === "-p";
}

function isPackageRunnerSeparateValueArg(value: string | undefined): boolean {
  return value != null && PACKAGE_RUNNER_VALUE_ARGS.has(value);
}

function replaceOptionsInToken(value: string): string {
  const equalsIndex = value.indexOf("=");
  if (equalsIndex !== -1 && value.startsWith("-")) {
    const name = value.slice(0, equalsIndex);
    return `${OPTION_MAP.get(name) ?? name}${value.slice(equalsIndex)}`;
  }
  return replaceOptionsInCommand(value);
}

function resetCliTemplateState(state: CliTemplateState): void {
  state.afterTailorBinary = false;
  state.commandMayBeNext = false;
  state.skipNextValue = false;
}

function tokenStart(token: TemplateToken): number | undefined {
  return token.segments[0]?.start;
}

function tokenEnd(token: TemplateToken): number | undefined {
  return token.segments.at(-1)?.end;
}

function hasUnescapedLineBreak(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\n" && value[index - 1] !== "\\") return true;
  }
  return false;
}

function hasTemplateCommandBoundaryBetween(
  previous: TemplateToken,
  next: TemplateToken,
  source: string,
): boolean {
  const previousEnd = tokenEnd(previous);
  const nextStart = tokenStart(next);
  if (previousEnd == null || nextStart == null) return false;
  return hasUnescapedLineBreak(source.slice(previousEnd, nextStart));
}

function hasCommandSeparatorToken(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (isCommandSeparator(value, index)) return true;
  }
  return false;
}

function isCommandSeparatorOnlyToken(value: string): boolean {
  return value !== "" && /^[;&|]+$/.test(value) && hasCommandSeparatorToken(value);
}

function isShellAssignmentToken(value: string): boolean {
  return /^[A-Za-z_]\w*=/.test(value);
}

function shellCommandPrefixEndIndex(values: string[]): number {
  let index = values[0] === "env" ? 1 : 0;
  const assignmentStart = index;
  while (index < values.length && isShellAssignmentToken(values[index]!)) {
    index += 1;
  }
  if (index > assignmentStart) return index;
  return values[0] === "env" ? 1 : 0;
}

function rewriteTokenizedCliArg(value: string, renameCommand: boolean): string {
  const commandRenamed = renameCommand ? (COMMAND_MAP.get(value) ?? value) : value;
  return replaceOptionsInToken(commandRenamed);
}

function rewriteCommandToken(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    if (!isCommandSeparator(value, index)) continue;
    const command = value.slice(0, index);
    return `${COMMAND_MAP.get(command) ?? command}${value.slice(index)}`;
  }
  return COMMAND_MAP.get(value) ?? value;
}

function isLikelySourceCommandString(value: string): boolean {
  const trimmed = value.trimStart();
  if (TAILOR_BINARY_TOKEN.test(trimmed.split(/\s+/, 1)[0] ?? "")) return true;
  if (/^(?:npx|bunx|pnpm|yarn)\b/.test(trimmed) && TAILOR_BINARY_PATTERN.test(trimmed)) {
    TAILOR_BINARY_PATTERN.lastIndex = 0;
    return true;
  }
  TAILOR_BINARY_PATTERN.lastIndex = 0;
  return (
    SHELL_ASSIGNMENT_PREFIX_PATTERN.test(trimmed) || SHELL_SEPARATOR_TAILOR_PATTERN.test(trimmed)
  );
}

function replaceSourceCommandString(value: string): string {
  TAILOR_BINARY_PATTERN.lastIndex = 0;
  if (!isLikelySourceCommandString(value)) return value;
  TAILOR_BINARY_PATTERN.lastIndex = 0;
  return replaceAll(value);
}

function isPackageRunnerOptionValueReference(source: string, start: number): boolean {
  return PACKAGE_RUNNER_OPTION_VALUE_PREFIX_PATTERN.test(source.slice(0, start));
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

function collectInterpolatedOptionEdits(
  node: SgNode,
  source: string,
  renameCommand = false,
): Array<[number, number, string]> {
  if (node.kind() !== "template_string") return [];
  if (!node.children().some((child: SgNode) => child.kind() === "template_substitution")) {
    return [];
  }

  const edits: Array<[number, number, string]> = [];
  for (const fragment of node
    .children()
    .filter((child: SgNode) => child.kind() === "string_fragment")) {
    const range = fragment.range();
    const text = source.slice(range.start.index, range.end.index);
    const replacement = replaceOptionsInCommand(text);
    if (replacement !== text) {
      edits.push([range.start.index, range.end.index, replacement]);
    }
  }
  if (templateStartsWithInlineOptionValue(node, source)) return edits;
  for (const substitution of node
    .children()
    .filter((child: SgNode) => child.kind() === "template_substitution")) {
    edits.push(...collectCliExpressionEdits(substitution, source, renameCommand));
  }
  return edits;
}

function cliArgExpressionChildren(node: SgNode): SgNode[] {
  if (node.kind() === "parenthesized_expression") return node.children();
  if (node.kind() === "as_expression" || node.kind() === "satisfies_expression") {
    return node.children().slice(0, 1);
  }
  if (node.kind() === "ternary_expression") return node.children().slice(1);
  if (node.kind() === "binary_expression" && /&&|\|\|/.test(node.text())) {
    return node.children().slice(1);
  }
  return [];
}

function collectCliExpressionEdits(
  node: SgNode,
  source: string,
  renameCommand: boolean,
): Array<[number, number, string]> {
  const token = sourceStringToken(node, source);
  if (token) {
    const replacement = rewriteTokenizedCliArg(token.value, renameCommand);
    return replacement === token.value ? [] : [[token.start, token.end, replacement]];
  }

  const edits: Array<[number, number, string]> = [];
  const cliArgChildren = cliArgExpressionChildren(node);
  const children = cliArgChildren.length > 0 ? cliArgChildren : node.children();
  for (const child of children) {
    edits.push(...collectCliExpressionEdits(child, source, renameCommand));
  }
  return edits;
}

function sourceStringValues(node: SgNode, source: string): string[] {
  const token = sourceStringToken(node, source);
  if (token) return [token.value];

  const values: string[] = [];
  if (node.kind() === "template_string") {
    for (const child of node.children()) {
      if (child.kind() !== "string_fragment") continue;
      const range = child.range();
      values.push(source.slice(range.start.index, range.end.index));
    }
  }
  const cliArgChildren = cliArgExpressionChildren(node);
  const children = cliArgChildren.length > 0 ? cliArgChildren : node.children();
  for (const child of children) {
    values.push(...sourceStringValues(child, source));
  }
  return values;
}

function templateStartsWithInlineOptionValue(node: SgNode, source: string): boolean {
  if (node.kind() !== "template_string") return false;
  const firstFragment = node.children().find((child: SgNode) => child.kind() === "string_fragment");
  if (!firstFragment) return false;
  const range = firstFragment.range();
  const text = source.slice(range.start.index, range.end.index).trimStart();
  const equalsIndex = text.indexOf("=");
  if (equalsIndex === -1) return false;
  return text.startsWith("-") && !/\s/.test(text.slice(0, equalsIndex));
}

function dynamicCliArgState(node: SgNode, source: string): "keep-command" | "skip-value" | null {
  if (templateStartsWithInlineOptionValue(node, source)) {
    const values = sourceStringValues(node, source);
    const first = values.find((value) => value.trim() !== "")?.trimStart() ?? "";
    const name = optionName(first);
    return isGlobalSeparateValueArg(name) ? "keep-command" : null;
  }

  const values = sourceStringValues(node, source)
    .map((value) => value.trim())
    .filter((value) => value !== "");
  if (values.length === 0) return null;
  if (
    values.every(
      (value) =>
        GLOBAL_BOOLEAN_ARGS.has(optionName(value)) ||
        isInlineGlobalValueArg(value) ||
        isOpenGlobalValueArg(value),
    )
  ) {
    return values.some((value) => isOpenGlobalValueArg(value)) ? "skip-value" : "keep-command";
  }
  return null;
}

function dynamicCliValueArgState(node: SgNode, source: string): "skip-value" | null {
  const values = sourceStringValues(node, source)
    .map((value) => value.trim())
    .filter((value) => value !== "");
  if (values.length === 0) return null;
  return values.every((value) => isOpenCliValueArg(value)) ? "skip-value" : null;
}

function advanceCliTemplateState(state: CliTemplateState, value: string): void {
  if (!state.afterTailorBinary) {
    if (TAILOR_BINARY_TOKEN.test(value)) {
      state.afterTailorBinary = true;
      state.commandMayBeNext = true;
      state.skipNextValue = false;
    }
    return;
  }

  if (state.skipNextValue) {
    state.skipNextValue = false;
    return;
  }

  const name = optionName(value);
  if (state.commandMayBeNext) {
    if (GLOBAL_BOOLEAN_ARGS.has(name)) return;
    if (isGlobalSeparateValueArg(name)) {
      state.skipNextValue = !value.includes("=") || value.endsWith("=");
      return;
    }
    if (!value.startsWith("-")) {
      state.commandMayBeNext = false;
    }
    return;
  }

  if (isAnySeparateValueArg(name) && (!value.includes("=") || value.endsWith("="))) {
    state.skipNextValue = true;
  }
}

function collectCliTemplateEdits(node: SgNode, source: string): CliTemplateEditResult {
  if (node.kind() !== "template_string") return { edits: [], protectedRanges: [] };

  const edits: Array<[number, number, string]> = [];
  const protectedRanges: TextRange[] = [];
  const state: CliTemplateState = {
    afterTailorBinary: false,
    commandMayBeNext: false,
    skipNextValue: false,
  };
  let skipNextPackageRunnerValue = false;
  const protectTemplateSubstitutions = (token: TemplateToken): void => {
    for (const substitution of token.substitutions) {
      const range = substitution.range();
      protectedRanges.push({ start: range.start.index, end: range.end.index });
    }
  };

  const tokens = collectTemplateTokens(node, source);
  for (const [index, token] of tokens.entries()) {
    const previous = tokens[index - 1];
    const hasCommandBoundaryBefore =
      previous != null && hasTemplateCommandBoundaryBetween(previous, token, source);
    if (hasCommandBoundaryBefore) {
      resetCliTemplateState(state);
    }

    const value = staticTemplateTokenValue(token);
    const tokenHasCommandSeparator = value !== undefined && hasCommandSeparatorToken(value);
    if (value !== undefined && isCommandSeparatorOnlyToken(value)) {
      resetCliTemplateState(state);
      continue;
    }

    if (!state.afterTailorBinary) {
      if (value !== undefined) {
        if (skipNextPackageRunnerValue) {
          skipNextPackageRunnerValue = false;
          continue;
        }
        if (isPackageRunnerSeparatePackageArg(value) || isPackageRunnerSeparateValueArg(value)) {
          skipNextPackageRunnerValue = true;
          continue;
        }
        if (
          TAILOR_BINARY_TOKEN.test(value) &&
          !isLikelyTemplateCommandToken(tokens, index, hasCommandBoundaryBefore)
        ) {
          continue;
        }
        advanceCliTemplateState(state, value);
      }
      continue;
    }

    if (state.skipNextValue) {
      protectTemplateSubstitutions(token);
      state.skipNextValue = false;
      continue;
    }

    if (token.quoted) {
      if (state.commandMayBeNext) {
        state.commandMayBeNext = false;
      }
      continue;
    }

    if (value !== undefined) {
      const name = optionName(value);
      if (state.commandMayBeNext) {
        if (GLOBAL_BOOLEAN_ARGS.has(name)) {
          if (tokenHasCommandSeparator) {
            resetCliTemplateState(state);
          }
          continue;
        }
        if (isGlobalSeparateValueArg(name)) {
          state.skipNextValue = !value.includes("=") || value.endsWith("=");
          if (tokenHasCommandSeparator) {
            resetCliTemplateState(state);
          }
          continue;
        }
        if (!value.startsWith("-")) {
          const replacement = rewriteCommandToken(value);
          if (replacement !== value) {
            pushTemplateTokenReplacement(edits, token, replacement);
          }
          state.commandMayBeNext = false;
          if (tokenHasCommandSeparator) {
            resetCliTemplateState(state);
          }
          continue;
        }
        if (tokenHasCommandSeparator) {
          resetCliTemplateState(state);
        }
        continue;
      }

      if (isOpenCliValueArg(value)) {
        state.skipNextValue = true;
        continue;
      }

      const replacement = replaceOptionsInToken(value);
      if (replacement !== value) {
        pushTemplateTokenReplacement(edits, token, replacement);
      }
      if (tokenHasCommandSeparator) {
        resetCliTemplateState(state);
      }
      continue;
    }

    if (state.commandMayBeNext) {
      if (isInlineGlobalValueArg(token.value)) {
        continue;
      }
      for (const substitution of token.substitutions) {
        edits.push(...collectCliExpressionEdits(substitution, source, true));
      }
      const dynamicState =
        token.value === TEMPLATE_SUBSTITUTION_PLACEHOLDER && token.substitutions.length === 1
          ? dynamicCliArgState(token.substitutions[0]!, source)
          : null;
      if (dynamicState === "keep-command") {
        continue;
      }
      if (dynamicState === "skip-value") {
        state.skipNextValue = true;
        continue;
      }
      state.commandMayBeNext = false;
      continue;
    }

    if (isInlineCliValueArg(token.value)) {
      continue;
    }
    for (const substitution of token.substitutions) {
      edits.push(...collectCliExpressionEdits(substitution, source, false));
    }
    const dynamicState =
      token.value === TEMPLATE_SUBSTITUTION_PLACEHOLDER && token.substitutions.length === 1
        ? dynamicCliValueArgState(token.substitutions[0]!, source)
        : null;
    if (dynamicState === "skip-value") {
      state.skipNextValue = true;
    }
  }

  return { edits, protectedRanges };
}

function isLikelyTemplateCommandToken(
  tokens: TemplateToken[],
  tokenIndex: number,
  hasCommandBoundaryBefore = false,
): boolean {
  if (tokenIndex === 0 || hasCommandBoundaryBefore) return true;

  const previous = tokens[tokenIndex - 1];
  if (previous && staticTemplateTokenValue(previous) !== undefined) {
    const value = staticTemplateTokenValue(previous)!;
    if (isCommandSeparatorOnlyToken(value)) return true;
  }

  const staticPrefixValues = tokens
    .slice(0, tokenIndex)
    .map((token) => staticTemplateTokenValue(token))
    .filter((value): value is string => value !== undefined);
  const shellPrefixEndIndex = shellCommandPrefixEndIndex(staticPrefixValues);
  if (shellPrefixEndIndex > 0 && shellPrefixEndIndex === staticPrefixValues.length) return true;
  const [first] = staticPrefixValues.slice(shellPrefixEndIndex);
  return first === "npx" || first === "bunx" || first === "pnpm" || first === "yarn";
}

function collectCliTemplateSourceEdits(
  root: SgNode,
  source: string,
  protectedRanges: TextRange[] = [],
): CliTemplateEditResult {
  const edits: Array<[number, number, string]> = [];
  const templateProtectedRanges = [...protectedRanges];
  const isProtected = (node: SgNode): boolean => {
    const range = node.range();
    return templateProtectedRanges.some(
      (protectedRange) =>
        protectedRange.start <= range.start.index && range.end.index <= protectedRange.end,
    );
  };

  const visit = (node: SgNode): void => {
    if (isProtected(node)) return;
    if (node.kind() === "template_string") {
      const result = collectCliTemplateEdits(node, source);
      edits.push(...result.edits);
      templateProtectedRanges.push(...result.protectedRanges);
    }
    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(root);
  return { edits, protectedRanges: templateProtectedRanges };
}

function collectSourceLiteralCliCommandEdits(
  root: SgNode,
  source: string,
  protectedRanges: TextRange[] = [],
): Array<[number, number, string]> {
  const edits: Array<[number, number, string]> = [];

  const isProtected = (node: SgNode): boolean => {
    const range = node.range();
    return protectedRanges.some(
      (protectedRange) =>
        protectedRange.start <= range.start.index && range.end.index <= protectedRange.end,
    );
  };

  const visit = (node: SgNode): void => {
    if (isProtected(node)) return;

    if (node.kind() === "comment") {
      const range = node.range();
      const text = source.slice(range.start.index, range.end.index);
      const replacement = replaceAll(text, false, true, true);
      if (replacement !== text) {
        edits.push([range.start.index, range.end.index, replacement]);
      }
      return;
    }

    if (node.kind() === "string") {
      const token = sourceStringToken(node, source);
      if (token) {
        const replacement = replaceSourceCommandString(token.value);
        if (replacement !== token.value) {
          edits.push([token.start, token.end, replacement]);
        }
      }
      return;
    }

    if (node.kind() === "jsx_text") {
      const range = node.range();
      const text = source.slice(range.start.index, range.end.index);
      const replacement = replaceSourceCommandString(text);
      if (replacement !== text) {
        edits.push([range.start.index, range.end.index, replacement]);
      }
      return;
    }

    for (const child of node.children()) {
      visit(child);
    }
  };

  visit(root);
  return edits;
}

function collectTokenizedSourceEdits(
  root: SgNode,
  source: string,
): { edits: Array<[number, number, string]>; protectedRanges: TextRange[] } {
  const edits: Array<[number, number, string]> = [];
  const protectedRanges: TextRange[] = [];

  const protectNode = (node: SgNode): void => {
    const range = node.range();
    protectedRanges.push({ start: range.start.index, end: range.end.index });
  };

  const visit = (node: SgNode, inheritedAfterTailorBinary = false): void => {
    if (inheritedAfterTailorBinary) {
      const token = sourceStringToken(node, source);
      if (token) {
        const replacement = rewriteTokenizedCliArg(token.value, true);
        if (replacement !== token.value) {
          edits.push([token.start, token.end, replacement]);
        }
        return;
      }
      edits.push(...collectInterpolatedOptionEdits(node, source));
    }

    if (isTokenSequenceNode(node)) {
      let afterTailorBinary = inheritedAfterTailorBinary;
      let commandMayBeNext = inheritedAfterTailorBinary;
      let skipNextValue = false;
      let skipNextPackageRunnerValue = false;
      let previousTokenValue: string | undefined;
      for (const child of node.children()) {
        const token = sourceStringToken(child, source);
        if (token) {
          const previous = previousTokenValue;
          previousTokenValue = token.value;

          if (!afterTailorBinary) {
            if (skipNextPackageRunnerValue) {
              skipNextPackageRunnerValue = false;
              continue;
            }
            if (
              isPackageRunnerSeparatePackageArg(token.value) ||
              isPackageRunnerSeparateValueArg(token.value)
            ) {
              skipNextPackageRunnerValue = true;
              continue;
            }
            afterTailorBinary = TAILOR_BINARY_TOKEN.test(token.value);
            commandMayBeNext = afterTailorBinary;
            continue;
          }

          if (
            skipNextValue ||
            (previous != null &&
              (commandMayBeNext ? isOpenGlobalValueArg(previous) : isOpenCliValueArg(previous)))
          ) {
            protectNode(child);
            skipNextValue = false;
            continue;
          }

          const name = optionName(token.value);
          const renameCommand = commandMayBeNext && !token.value.startsWith("-");
          const replacement =
            commandMayBeNext &&
            token.value.startsWith("-") &&
            !GLOBAL_BOOLEAN_ARGS.has(name) &&
            !isOpenGlobalValueArg(token.value)
              ? token.value
              : rewriteTokenizedCliArg(token.value, renameCommand);
          if (replacement !== token.value) {
            edits.push([token.start, token.end, replacement]);
          }
          if (commandMayBeNext) {
            if (GLOBAL_BOOLEAN_ARGS.has(name)) {
              continue;
            }
            if (isOpenGlobalValueArg(token.value)) {
              skipNextValue = true;
              continue;
            }
            if (!token.value.startsWith("-")) {
              commandMayBeNext = false;
            }
          } else if (isOpenCliValueArg(token.value)) {
            skipNextValue = true;
          }
          continue;
        }

        if (isSyntaxOnlyNode(child)) {
          visit(child);
          continue;
        }

        if (!afterTailorBinary && skipNextPackageRunnerValue) {
          visit(child);
          skipNextPackageRunnerValue = false;
          previousTokenValue = undefined;
          continue;
        }

        if (skipNextValue) {
          protectNode(child);
          skipNextValue = false;
          previousTokenValue = undefined;
          continue;
        }

        const childCanHoldCommand =
          isTokenSequenceNode(child) || cliArgExpressionChildren(child).length > 0;

        if (afterTailorBinary && commandMayBeNext) {
          edits.push(...collectInterpolatedOptionEdits(child, source, commandMayBeNext));
        } else if (afterTailorBinary) {
          edits.push(...collectInterpolatedOptionEdits(child, source, false));
          if (!templateStartsWithInlineOptionValue(child, source)) {
            edits.push(...collectCliExpressionEdits(child, source, false));
          }
        }

        visit(
          child,
          afterTailorBinary && commandMayBeNext && !skipNextValue && childCanHoldCommand,
        );
        if (commandMayBeNext && afterTailorBinary) {
          const dynamicState = dynamicCliArgState(child, source);
          if (dynamicState === "keep-command") {
            continue;
          }
          if (dynamicState === "skip-value") {
            skipNextValue = true;
            continue;
          }
          commandMayBeNext = false;
        } else if (afterTailorBinary) {
          const dynamicState = dynamicCliValueArgState(child, source);
          if (dynamicState === "skip-value") {
            skipNextValue = true;
          }
        }
      }
      return;
    }

    const cliArgChildren = inheritedAfterTailorBinary ? cliArgExpressionChildren(node) : [];
    if (cliArgChildren.length > 0) {
      for (const child of cliArgChildren) {
        visit(child, true);
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

function replaceTokenizedSourceCliCommands(source: string, filePath: string): string {
  let root: SgNode;
  try {
    root = parse(sourceLang(filePath), source).root();
  } catch {
    return source;
  }

  let updated = source;
  const tokenized = collectTokenizedSourceEdits(root, source);
  const template = collectCliTemplateSourceEdits(root, source, tokenized.protectedRanges);
  const protectedRanges = [...tokenized.protectedRanges, ...template.protectedRanges];
  const editByRange = new Map<string, [number, number, string]>();
  for (const edit of [
    ...tokenized.edits,
    ...template.edits,
    ...collectSourceLiteralCliCommandEdits(root, source, protectedRanges),
  ]) {
    editByRange.set(`${edit[0]}:${edit[1]}`, edit);
  }
  const edits = Array.from(editByRange.values()).toSorted(([a], [b]) => b - a);
  for (const [start, end, replacement] of edits) {
    updated = `${updated.slice(0, start)}${replacement}${updated.slice(end)}`;
  }
  return updated;
}

function protectCliValueStrings(source: string): { source: string; protectedValues: string[] } {
  const protectedValues: string[] = [];
  const updated = source.replace(
    /(["'`])(?:--env-file-if-exists|--env-file|--arg|--query|--file|-e|-a|-q|-f)\1\s*,\s*(["'`])([^"'`]*?(?:crash-report|--machineuser)[^"'`]*)\2/g,
    (match, _optionQuote: string, valueQuote: string, value: string) => {
      const placeholder = `__TAILOR_CLI_RENAME_PROTECTED_${protectedValues.length}__`;
      protectedValues.push(value);
      return match.replace(
        `${valueQuote}${value}${valueQuote}`,
        `${valueQuote}${placeholder}${valueQuote}`,
      );
    },
  );
  return { source: updated, protectedValues };
}

function restoreCliValueStrings(source: string, protectedValues: string[]): string {
  let restored = source;
  for (const [index, value] of protectedValues.entries()) {
    restored = restored.replaceAll(`__TAILOR_CLI_RENAME_PROTECTED_${index}__`, value);
  }
  return restored.replace(
    /((["'`])tailor-sdk\2\s*,\s*(["'`])(?:--env-file|--env-file-if-exists|-e)\3\s*,\s*(["'`])[^"'`]*\4\s*,\s*)(["'`])crash-report\5/g,
    "$1$5crashreport$5",
  );
}

function replaceOptionsInTailorCommands(
  source: string,
  foldedYamlRanges?: TextRange[],
  requireDelimitedContext = false,
  markdownFencedCodeRanges?: TextRange[],
): string {
  let updated = "";
  let cursor = 0;
  TAILOR_BINARY_PATTERN.lastIndex = 0;

  for (;;) {
    const match = TAILOR_BINARY_PATTERN.exec(source);
    if (!match) break;

    const start = match.index;
    if (start < cursor) continue;

    if (isPackageRunnerOptionValueReference(source, start)) {
      TAILOR_BINARY_PATTERN.lastIndex = start + match[0].length;
      continue;
    }

    if (
      requireDelimitedContext &&
      !isDelimitedCommandContext(source, start, foldedYamlRanges, markdownFencedCodeRanges)
    ) {
      TAILOR_BINARY_PATTERN.lastIndex = start + match[0].length;
      continue;
    }

    const end = findTailorCommandEnd(source, start, foldedYamlRanges, markdownFencedCodeRanges);
    updated += source.slice(cursor, start);
    updated += replaceCliRenamesInCommand(source.slice(start, end));
    cursor = end;
    TAILOR_BINARY_PATTERN.lastIndex = end;
  }

  return updated + source.slice(cursor);
}

function replaceAll(
  value: string,
  parseFoldedYaml = false,
  requireDelimitedContext = false,
  parseMarkdownFencedCode = false,
): string {
  const foldedYamlRanges = parseFoldedYaml ? findFoldedYamlRanges(value) : undefined;
  const markdownFencedCodeRanges = parseMarkdownFencedCode
    ? findMarkdownFencedCodeRanges(value)
    : undefined;
  return replaceOptionsInTailorCommands(
    value,
    foldedYamlRanges,
    requireDelimitedContext,
    markdownFencedCodeRanges,
  );
}

function transformText(source: string, filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const isYaml = ext === ".yml" || ext === ".yaml";
  const isMarkdown = ext === ".md";
  if (SOURCE_EXTENSIONS.has(ext)) {
    const protectedSource = protectCliValueStrings(source);
    let updated = replaceTokenizedSourceCliCommands(protectedSource.source, filePath);
    updated = restoreCliValueStrings(updated, protectedSource.protectedValues);
    return updated === source ? null : updated;
  }
  const updated = replaceAll(source, isYaml, isMarkdown, isMarkdown);
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
      const updated = replaceAll(value);
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
 * Apply v2 CLI naming conventions: multi-word commands collapse into a single
 * word (`crash-report` → `crashreport`), and legacy option spellings are
 * rewritten to kebab-case (`--machineuser` → `--machine-user`). Optional
 * `@version` pins on the binary (`tailor-sdk@latest`) are preserved.
 *
 * @param source - File contents
 * @param filePath - Absolute path to the file (used to dispatch package.json vs text)
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return transformPackageJson(source);
  return transformText(source, filePath);
}
