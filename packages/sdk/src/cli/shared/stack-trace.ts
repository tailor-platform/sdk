/**
 * Stack trace parsing, sourcemap mapping, and formatted error display
 * for the test-run command.
 *
 * Parses V8 stack traces from bundled/minified function errors,
 * maps positions back to original source using inline sourcemaps,
 * and produces human-readable output with file paths and code snippets.
 */

import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { styles } from "@/cli/shared/logger";

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

  // Extract error message (all non-frame lines before the first frame)
  const messageLines: string[] = [];
  const frameLines: string[] = [];

  for (const line of lines) {
    if (line.match(/^\s+at\s+/)) {
      frameLines.push(line);
    } else if (frameLines.length === 0) {
      messageLines.push(line);
    }
  }

  let errorMessage = messageLines.join("\n");

  // Strip rpc error prefix
  if (errorMessage.startsWith(RPC_ERROR_PREFIX)) {
    errorMessage = errorMessage.slice(RPC_ERROR_PREFIX.length);
  }

  // Parse each frame line
  const frames: StackFrame[] = [];
  for (const line of frameLines) {
    const match = STACK_FRAME_REGEX.exec(line);
    if (match) {
      frames.push({
        functionName: match[1] || "<anonymous>",
        file: match[2],
        line: Number(match[3]),
        column: Number(match[4]),
      });
    }
  }

  return { errorMessage, frames };
}

// Matches the inline sourcemap comment at the end of bundled code
const INLINE_SOURCEMAP_REGEX =
  /\/\/[#@]\s*sourceMappingURL=data:application\/json[^,]*;base64,(.+)$/m;

/** A stack frame mapped back to original source */
export interface MappedStackFrame {
  /** The original parsed frame */
  original: StackFrame;
  /** Mapped source position, or null if mapping failed */
  mapped: {
    source: string;
    line: number;
    column: number;
    name: string | null;
  } | null;
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
    const decoded = Buffer.from(match[1], "base64").toString("utf-8");
    const rawSourceMap = JSON.parse(decoded);
    return new TraceMap(rawSourceMap);
  } catch {
    return null;
  }
}

/**
 * Map parsed stack frames to original source positions using a TraceMap.
 * V8 column numbers are 1-based; trace-mapping expects 0-based columns.
 * @param frames - Parsed stack frames
 * @param traceMap - TraceMap from inline sourcemap, or null
 * @returns Frames with mapped source positions
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
      const pos = originalPositionFor(traceMap, {
        line: frame.line,
        column: frame.column - 1, // V8 is 1-based, trace-mapping is 0-based
      });

      if (pos.source == null) {
        return { original: frame, mapped: null };
      }

      return {
        original: frame,
        mapped: {
          source: pos.source,
          line: pos.line!,
          column: (pos.column ?? 0) + 1, // Convert back to 1-based
          name: pos.name,
        },
      };
    } catch {
      return { original: frame, mapped: null };
    }
  });
}

// Number of context lines to show above and below the error line
const SNIPPET_CONTEXT_LINES = 2;

/**
 * Build a code snippet around a target line from source content.
 * Shows SNIPPET_CONTEXT_LINES above and below with line numbers.
 * The target line is marked with `>` and highlighted.
 * @param content - Full source file content
 * @param targetLine - 1-based line number to highlight
 * @returns Formatted snippet string, or null if content is unavailable
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
 * @returns Formatted error string for display
 */
export function formatMappedError(
  errorMessage: string,
  frames: MappedStackFrame[],
  traceMap: TraceMap | null,
): string {
  const parts: string[] = [`  ${styles.error(errorMessage)}`];

  for (const frame of frames) {
    if (frame.mapped) {
      const { source, line, column, name } = frame.mapped;
      const location = `${source}:${line}:${column}`;
      const fnName = name ?? frame.original.functionName;
      parts.push(`\n  at ${fnName} (${styles.info(location)})`);

      // Try to get source content for snippet
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
      // Unmapped frame: show original info dimmed
      const file = frame.original.file.replace(/^file:\/\/\//, "");
      const location = `${file}:${frame.original.line}:${frame.original.column}`;
      parts.push(`\n  ${styles.dim(`at ${frame.original.functionName} (${location})`)}`);
    }
  }

  return parts.join("\n");
}

/**
 * Detect the line offset added by the server's script wrapper.
 *
 * The platform server wraps bundled code with boilerplate lines before execution.
 * Stack traces report absolute line numbers in the wrapped script, not relative
 * to the bundled code. This function finds the best offset by trying all valid
 * offsets that keep frame lines within the bundle's code line range, selecting
 * the one that maps the most frames successfully.
 * @param frames - Parsed stack frames from the error
 * @param traceMap - TraceMap from inline sourcemap
 * @param bundledCode - Bundled JavaScript code
 * @returns Line offset to subtract from frame line numbers, or 0 if none detected
 */
function detectServerLineOffset(
  frames: StackFrame[],
  traceMap: TraceMap,
  bundledCode: string,
): number {
  if (frames.length === 0) return 0;

  // Count actual code lines (before sourcemap comment)
  const lines = bundledCode.split("\n");
  let codeLineCount = 0;
  for (const line of lines) {
    if (/^\/\/[#@]\s*sourceMappingURL/.test(line)) break;
    codeLineCount++;
  }
  if (codeLineCount === 0) return 0;

  // Determine valid offset range where all frame lines land within [1, codeLineCount]
  const minOffset = Math.max(0, ...frames.map((f) => f.line - codeLineCount));
  const maxOffset = Math.min(...frames.map((f) => f.line - 1));
  if (maxOffset < minOffset) return 0;

  let bestOffset = 0;
  let bestMappedCount = 0;

  for (let offset = minOffset; offset <= maxOffset; offset++) {
    let mappedCount = 0;
    for (const frame of frames) {
      const pos = originalPositionFor(traceMap, {
        line: frame.line - offset,
        column: frame.column - 1,
      });
      if (pos.source != null) mappedCount++;
    }
    if (mappedCount > bestMappedCount) {
      bestMappedCount = mappedCount;
      bestOffset = offset;
    }
  }

  return bestOffset;
}

/**
 * Format an error string with sourcemap-based source locations.
 * This is the main entry point for test-run error display.
 *
 * Returns a formatted error string with original file paths, line numbers,
 * and code snippets, or null if sourcemap processing is not possible
 * (no inline sourcemap, no stack trace, or processing error).
 * @param error - Raw error string from script execution (may contain V8 stack trace)
 * @param bundledCode - Bundled JavaScript code (may contain inline sourcemap)
 * @returns Formatted error string, or null to fall back to default display
 */
export function formatErrorWithSourcemap(error: string, bundledCode: string): string | null {
  try {
    const { errorMessage, frames } = parseStackTrace(error);
    if (frames.length === 0) return null;

    const traceMap = extractInlineSourcemap(bundledCode);
    if (!traceMap) return null;

    // Detect server wrapper offset (0 if no wrapping) and adjust frame lines
    const offset = detectServerLineOffset(frames, traceMap, bundledCode);
    const adjustedFrames =
      offset > 0 ? frames.map((f) => ({ ...f, line: f.line - offset })) : frames;
    const mappedFrames = mapStackFrames(adjustedFrames, traceMap);

    if (mappedFrames.some((f) => f.mapped !== null)) {
      return formatMappedError(errorMessage, mappedFrames, traceMap);
    }

    return null;
  } catch {
    return null;
  }
}
