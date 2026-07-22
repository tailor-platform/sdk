/**
 * Stack trace parsing, sourcemap-based source identification, and
 * formatted error display for the test-run command.
 *
 * The platform runtime automatically applies inline sourcemaps to V8
 * stack traces, so frame positions are already original source positions.
 * This module identifies which source file each frame belongs to via
 * reverse lookup (generatedPositionFor), then produces human-readable
 * output with file paths and code snippets.
 */

import { TraceMap, generatedPositionFor, originalPositionFor } from "@jridgewell/trace-mapping";
import * as path from "pathe";
import { styles } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";

/** A single frame parsed from a V8 stack trace */
export interface StackFrame {
  /** Function name (e.g. "M", "Object.body", "<anonymous>") */
  functionName: string;
  /** File URL (e.g. "file:///test-run--error-test.js") */
  file: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
}

/** Result of parsing a V8 stack trace string */
export interface ParsedStackTrace {
  /** Error message with rpc prefix stripped */
  errorMessage: string;
  /** Parsed stack frames (only file:/// frames) */
  frames: StackFrame[];
}

// Matches: "    at functionName (file:///path:line:col)"
// Or:      "    at file:///path:line:col"
const STACK_FRAME_REGEX = /^\s+at\s+(?:(.+?)\s+\()?(file:\/\/\/.+?):(\d+):(\d+)\)?$/;

// The rpc error prefix added by the platform
const RPC_ERROR_PREFIX = "rpc error: code = Aborted desc = ";

/**
 * Parse a V8 stack trace string into structured frames.
 * Only frames with `file:///` URLs are included (eval frames are skipped).
 * @param error - Raw error string potentially containing a V8 stack trace
 * @returns Parsed error message and stack frames
 */
export function parseStackTrace(error: string): ParsedStackTrace {
  const lines = error.split("\n");

  const messageLines: string[] = [];
  const frameLines: string[] = [];

  for (const line of lines) {
    if (/^\s+at\s+/.test(line)) {
      frameLines.push(line);
    } else if (frameLines.length === 0) {
      messageLines.push(line);
    }
  }

  let errorMessage = messageLines.join("\n");

  if (errorMessage.startsWith(RPC_ERROR_PREFIX)) {
    errorMessage = errorMessage.slice(RPC_ERROR_PREFIX.length);
  }

  const frames: StackFrame[] = [];
  for (const line of frameLines) {
    const match = STACK_FRAME_REGEX.exec(line);
    if (match) {
      frames.push({
        functionName: match[1] || "<anonymous>",
        file: assertDefined(match[2], "stack frame file missing"),
        line: Number(assertDefined(match[3], "stack frame line missing")),
        column: Number(assertDefined(match[4], "stack frame column missing")),
      });
    }
  }

  return { errorMessage, frames };
}

const INLINE_SOURCEMAP_REGEX =
  /\/\/[#@]\s*sourceMappingURL=data:application\/json[^,]*;base64,(.+)$/m;

/** Original source position resolved from a sourcemap */
export interface MappedSourcePosition {
  source: string;
  line: number;
  column: number;
  name: string | null;
}

/** A stack frame mapped back to original source */
export interface MappedStackFrame {
  /** The original parsed frame */
  original: StackFrame;
  /** Mapped source position, or null if mapping failed */
  mapped: MappedSourcePosition | null;
}

/**
 * Extract an inline sourcemap from bundled code and return a TraceMap.
 * @param bundledCode - Bundled JavaScript code potentially containing an inline sourcemap
 * @returns TraceMap instance, or null if no valid inline sourcemap is found
 */
export function extractInlineSourcemap(bundledCode: string): TraceMap | null {
  const match = INLINE_SOURCEMAP_REGEX.exec(bundledCode);
  if (!match) return null;

  try {
    const decoded = Buffer.from(
      assertDefined(match[1], "sourcemap base64 data missing"),
      "base64",
    ).toString("utf-8");
    const rawSourceMap = JSON.parse(decoded);
    return new TraceMap(rawSourceMap);
  } catch {
    return null;
  }
}

/**
 * Map parsed stack frames to their source files using a TraceMap.
 *
 * The platform runtime applies inline sourcemaps automatically, so V8
 * reports already-mapped original source positions in stack traces.
 * This function uses generatedPositionFor to reverse-lookup which source
 * file each frame's line:column belongs to.
 * @param frames - Parsed stack frames (positions are already original source positions)
 * @param traceMap - TraceMap from inline sourcemap, or null
 * @returns Frames with identified source files
 */
export function mapStackFrames(
  frames: StackFrame[],
  traceMap: TraceMap | null,
): MappedStackFrame[] {
  return frames.map((frame) => {
    if (!traceMap) {
      return { original: frame, mapped: null };
    }

    try {
      // Iterate in reverse: user code and entry file are typically last
      // in the sources array, while SDK internals and node_modules come first.
      for (let i = traceMap.sources.length - 1; i >= 0; i--) {
        const source = traceMap.sources[i];
        if (source == null) continue;

        const genPos = generatedPositionFor(traceMap, {
          source,
          line: frame.line,
          column: frame.column - 1, // V8 is 1-based, trace-mapping is 0-based
        });

        if (genPos.line == null) continue;

        // Round-trip validation: generatedPositionFor uses
        // GREATEST_LOWER_BOUND bias by default, so it may return a
        // near-match when the queried source has a mapping on the target
        // line at an earlier column. Verify the generated position maps
        // back to the exact (source, line, column) we queried before
        // accepting the match; otherwise try the next source.
        const origPos = originalPositionFor(traceMap, {
          line: genPos.line,
          column: genPos.column,
        });
        if (
          origPos.source !== source ||
          origPos.line !== frame.line ||
          origPos.column !== frame.column - 1
        ) {
          continue;
        }

        return {
          original: frame,
          mapped: {
            source,
            line: frame.line,
            column: frame.column,
            name: null,
          },
        };
      }

      return { original: frame, mapped: null };
    } catch {
      return { original: frame, mapped: null };
    }
  });
}

/**
 * Detect the URI scheme for opening files based on VISUAL/EDITOR env vars.
 * @returns "vscode" if the editor looks like VS Code, otherwise null (use file://)
 */
function detectEditorScheme(): string | null {
  const editor = process.env.VISUAL || process.env.EDITOR || "";
  if (/\bcode\b/.test(editor)) return "vscode";
  return null;
}

/**
 * Wrap text in an OSC 8 terminal hyperlink.
 * @param uri - URI to open when the link is clicked
 * @param text - Visible text displayed in the terminal
 * @returns Escaped string with OSC 8 sequences
 */
function osc8Link(uri: string, text: string): string {
  return `\x1b]8;;${uri}\x07${text}\x1b]8;;\x07`;
}

/**
 * Build a clickable terminal link for a source location.
 * Uses vscode:// URI if the editor is VS Code, otherwise file:// URI.
 * @param displayPath - Path to display in the terminal
 * @param absolutePath - Absolute file path for the URI
 * @param line - 1-based line number
 * @param column - 1-based column number
 * @returns OSC 8 hyperlinked location string
 */
function buildSourceLink(
  displayPath: string,
  absolutePath: string,
  line: number,
  column: number,
): string {
  const location = `${displayPath}:${line}:${column}`;
  const scheme = detectEditorScheme();
  if (scheme === "vscode") {
    return osc8Link(`vscode://file${absolutePath}:${line}:${column}`, location);
  }
  return osc8Link(`file://${absolutePath}`, location);
}

const SNIPPET_CONTEXT_LINES = 2;

/**
 * Build a code snippet around a target line from source content.
 * Shows SNIPPET_CONTEXT_LINES above and below with line numbers.
 * The target line is marked with `>` and highlighted.
 * @param content - Full source file content
 * @param targetLine - 1-based line number to highlight
 * @returns Formatted snippet string
 */
function buildCodeSnippet(content: string, targetLine: number): string {
  const lines = content.split("\n");
  const start = Math.max(0, targetLine - 1 - SNIPPET_CONTEXT_LINES);
  const end = Math.min(lines.length, targetLine + SNIPPET_CONTEXT_LINES);

  const gutterWidth = String(end).length;
  const snippetLines: string[] = [];

  for (let i = start; i < end; i++) {
    const lineNum = i + 1;
    const gutter = String(lineNum).padStart(gutterWidth);
    const lineContent = lines[i];

    if (lineNum === targetLine) {
      snippetLines.push(`  ${styles.error(">")} ${styles.error(`${gutter} | ${lineContent}`)}`);
    } else {
      snippetLines.push(`    ${styles.dim(`${gutter} | ${lineContent}`)}`);
    }
  }

  return snippetLines.join("\n");
}

/**
 * Format mapped stack frames into a human-readable error display.
 * Includes file paths (clickable in terminals), code snippets, and
 * falls back to raw frame info for unmapped frames.
 * @param errorMessage - Cleaned error message
 * @param frames - Mapped stack frames
 * @param traceMap - TraceMap for retrieving source content (may be null)
 * @param bundleDir - Absolute path to bundle output directory for resolving source paths
 * @returns Formatted error string for display
 */
export function formatMappedError(
  errorMessage: string,
  frames: MappedStackFrame[],
  traceMap: TraceMap | null,
  bundleDir?: string,
): string {
  const parts: string[] = [`  ${styles.error(errorMessage)}`];

  for (const frame of frames) {
    if (frame.mapped) {
      const { source, line, column, name } = frame.mapped;
      const absolutePath = bundleDir ? path.resolve(bundleDir, source) : path.resolve(source);
      const rel = path.relative(process.cwd(), absolutePath);
      // Only paths escaping cwd (starting with `..`) are shown as-is; all
      // other relative paths get an explicit `./` prefix so dotfiles like
      // `.tailor-sdk/...` are not mistaken for relative-path markers.
      const displaySource = rel.startsWith("..") ? rel : `./${rel}`;
      const fnName = name ?? frame.original.functionName;
      const link = buildSourceLink(displaySource, absolutePath, line, column);
      parts.push(`\n  at ${fnName} (${link})`);

      if (traceMap) {
        const sourceIndex = traceMap.sources.indexOf(source);
        if (sourceIndex !== -1) {
          const content = traceMap.sourcesContent?.[sourceIndex];
          if (content) {
            parts.push(buildCodeSnippet(content, line));
          }
        }
      }
    } else {
      const file = frame.original.file.replace(/^file:\/\/\//, "");
      const location = `${file}:${frame.original.line}:${frame.original.column}`;
      parts.push(`\n  ${styles.dim(`at ${frame.original.functionName} (${location})`)}`);
    }
  }

  return parts.join("\n");
}

/**
 * Format an error string with sourcemap-based source locations.
 * This is the main entry point for test-run error display.
 *
 * The platform runtime applies inline sourcemaps automatically, so V8
 * stack frames already contain original source positions. This function
 * identifies which source file each frame belongs to and formats the
 * error with file paths, line numbers, and code snippets.
 *
 * Returns null if sourcemap processing is not possible (no inline
 * sourcemap, no stack trace, or processing error).
 * @param error - Raw error string from script execution (may contain V8 stack trace)
 * @param bundledCode - Bundled JavaScript code (may contain inline sourcemap)
 * @param bundleDir - Absolute path to the bundle output directory (sourcemap paths are relative to this)
 * @returns Formatted error string, or null to fall back to default display
 */
export function formatErrorWithSourcemap(
  error: string,
  bundledCode: string,
  bundleDir: string,
): string | null {
  try {
    const { errorMessage, frames } = parseStackTrace(error);
    if (frames.length === 0) return null;

    const traceMap = extractInlineSourcemap(bundledCode);
    if (!traceMap) return null;

    const mappedFrames = mapStackFrames(frames, traceMap);

    if (mappedFrames.some((f) => f.mapped !== null)) {
      return formatMappedError(errorMessage, mappedFrames, traceMap, bundleDir);
    }

    return null;
  } catch {
    return null;
  }
}
