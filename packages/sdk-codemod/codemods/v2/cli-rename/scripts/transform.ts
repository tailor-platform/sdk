import * as path from "pathe";

// Map of v1 multi-word command names to their v2 single-word replacements.
const COMMAND_RENAMES: ReadonlyArray<readonly [string, string]> = [["crash-report", "crashreport"]];
const OPTION_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["--machineuser", "--machine-user"],
];

const ARG_VALUE = `(?:[^\\s'"\`;&|]+|'[^']*'|"(?:(?:\\\\.)|[^"\\\\])*")`;
const BOOLEAN_GLOBAL_ARG = "(?:--verbose|--json|-j)";
const VALUE_GLOBAL_ARG = "(?:--env-file|--env-file-if-exists|-e)";
const GLOBAL_ARG_PATTERN = `(?:(?:\\s+${BOOLEAN_GLOBAL_ARG})|(?:\\s+${VALUE_GLOBAL_ARG}(?:=${ARG_VALUE}|\\s+${ARG_VALUE})))*`;
const COMMAND_PATTERN = new RegExp(
  `\\btailor-sdk(@[^\\s'"\`]+)?(${GLOBAL_ARG_PATTERN}\\s+)(${COMMAND_RENAMES.map(([from]) => from).join("|")})\\b`,
  "g",
);
const TAILOR_BINARY_PATTERN = /\btailor-sdk(?:@[^\s'"`]+)?/g;

const COMMAND_MAP = new Map(COMMAND_RENAMES);

interface FoldedYamlRange {
  start: number;
  end: number;
}

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

function findFoldedYamlRanges(source: string): FoldedYamlRange[] {
  const ranges: FoldedYamlRange[] = [];
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

function findContainingFoldedYamlRange(
  ranges: FoldedYamlRange[] | undefined,
  index: number,
): FoldedYamlRange | undefined {
  return ranges?.find((range) => range.start <= index && index < range.end);
}

function findTailorCommandEnd(
  source: string,
  start: number,
  foldedYamlRanges?: FoldedYamlRange[],
): number {
  const limit = Math.min(
    findInlineCodeSpanEnd(source, start) ?? source.length,
    findEnclosingLineQuoteEnd(source, start) ?? source.length,
  );
  const foldedYamlRange = findContainingFoldedYamlRange(foldedYamlRanges, start);
  const commandLimit = foldedYamlRange ? Math.min(limit, foldedYamlRange.end) : limit;
  let quote: "'" | '"' | null = null;
  let end = start;

  while (end < commandLimit) {
    const ch = source[end];

    if (quote !== null) {
      if (ch === "\\" && quote === '"' && end + 1 < commandLimit) {
        end += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      end += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      end += 1;
      continue;
    }

    const prev = source[end - 1];
    if ((ch === ";" || ch === "&" || ch === "|") && prev !== "\\") break;
    if (ch === "\n" && prev !== "\\" && !foldedYamlRange) break;
    end += 1;
  }
  return end;
}

function findOptionRename(command: string, index: number): readonly [string, string] | undefined {
  return OPTION_RENAMES.find(
    ([from]) =>
      command.startsWith(from, index) &&
      isOptionBoundaryChar(command[index - 1]) &&
      isOptionBoundaryChar(command[index + from.length]),
  );
}

function replaceOptionsInCommand(command: string): string {
  let updated = "";
  let index = 0;
  let quote: "'" | '"' | null = null;

  while (index < command.length) {
    const ch = command[index];

    if (quote !== null) {
      updated += ch;
      if (ch === "\\" && quote === '"' && index + 1 < command.length) {
        index += 1;
        updated += command[index];
      } else if (ch === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      updated += ch;
      index += 1;
      continue;
    }

    const rename = findOptionRename(command, index);
    if (rename) {
      updated += rename[1];
      index += rename[0].length;
      continue;
    }

    updated += ch;
    index += 1;
  }

  return updated;
}

function replaceOptionsInTailorCommands(
  source: string,
  foldedYamlRanges?: FoldedYamlRange[],
): string {
  let updated = "";
  let cursor = 0;
  TAILOR_BINARY_PATTERN.lastIndex = 0;

  for (;;) {
    const match = TAILOR_BINARY_PATTERN.exec(source);
    if (!match) break;

    const start = match.index;
    if (start < cursor) continue;

    const end = findTailorCommandEnd(source, start, foldedYamlRanges);
    updated += source.slice(cursor, start);
    updated += replaceOptionsInCommand(source.slice(start, end));
    cursor = end;
    TAILOR_BINARY_PATTERN.lastIndex = end;
  }

  return updated + source.slice(cursor);
}

function replaceAll(value: string, parseFoldedYaml = false): string {
  const updated = value.replace(
    COMMAND_PATTERN,
    (_match, ver: string | undefined, prefix: string, cmd: string) =>
      `tailor-sdk${ver ?? ""}${prefix}${COMMAND_MAP.get(cmd) ?? cmd}`,
  );
  const foldedYamlRanges = parseFoldedYaml ? findFoldedYamlRanges(updated) : undefined;
  return replaceOptionsInTailorCommands(updated, foldedYamlRanges);
}

function transformText(source: string, filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const updated = replaceAll(source, ext === ".yml" || ext === ".yaml");
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
