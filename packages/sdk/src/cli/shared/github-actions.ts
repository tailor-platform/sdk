import { stripVTControlCharacters } from "node:util";
import { isAbsolute, relative, resolve, sep } from "pathe";
import {
  getErrorDiagnostics,
  withErrorDiagnostics,
  type ErrorSourceLocation,
} from "./error-diagnostics";
import { isCLIError } from "./errors";
import { parseBoolean } from "./parse-boolean";

/**
 * Properties attached to a GitHub Actions annotation.
 *
 * `file`/`line` are accepted but not yet populated by any CLI error; they are
 * part of the command format so producers can add source locations later.
 */
export interface AnnotationProperties {
  /** Short heading shown above the annotation body. */
  title?: string;
  /** Path of the file the annotation points at, relative to the workspace. */
  file?: string;
  /** 1-based line number within `file`. */
  line?: number;
}

/** Annotation severities supported by the GitHub Actions runner. */
export type AnnotationLevel = "error" | "warning" | "notice";

/**
 * Escape a workflow command message body.
 *
 * The runner parses commands line by line, so a literal `%` and any line
 * break must be percent-encoded or the remainder of the message is dropped.
 * @param value - Raw message text
 * @returns Escaped message safe to place after `::`
 */
function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/**
 * Escape a workflow command property value.
 *
 * Property values additionally delimit on `:` and `,`, so both are encoded on
 * top of the message-body escapes.
 * @param value - Raw property value
 * @returns Escaped value safe to place inside the property list
 */
function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/**
 * Report whether `--json` was requested on the command line.
 *
 * A failure during argument validation ends the command before the `--json`
 * effect sets the logger's mode, so the flag is read from argv instead.
 * Tokens after `--` are positional values, never flags.
 * @returns True when argv requests JSON output
 */
function jsonRequestedInArgv(): boolean {
  const args = process.argv.slice(2);
  const separator = args.indexOf("--");
  const options = separator === -1 ? args : args.slice(0, separator);
  return options.some((value) => {
    const assignment = value.indexOf("=");
    const name = assignment === -1 ? value : value.slice(0, assignment);
    if (name !== "--json" && name !== "-j") return false;
    return assignment === -1 || parseBoolean(value.slice(assignment + 1)) !== false;
  });
}

/**
 * Report whether workflow commands should be written.
 *
 * Read at emission time rather than at import time so values loaded from
 * `--env-file` are honored.
 * @param jsonMode - Whether the CLI is producing a JSON document
 * @returns True when annotations should be emitted
 */
export function annotationsEnabled(jsonMode: boolean): boolean {
  if (jsonMode || jsonRequestedInArgv()) return false;
  if (process.env.GITHUB_ACTIONS !== "true") return false;
  return parseBoolean(process.env.TAILOR_GITHUB_ACTIONS_ANNOTATIONS) !== false;
}

/**
 * Render a path the way GitHub Actions resolves annotation locations.
 *
 * Steps run with `working-directory` set, so a cwd-relative path points at the
 * wrong file; the runner resolves annotation paths against the workspace root.
 * Containment is decided by the relative path rather than a prefix match, so a
 * sibling such as `/repo-other` is not read as living inside `/repo`.
 * @param file - Absolute path to the file the failure points at
 * @returns Workspace-relative path, or undefined when it lies outside
 */
export function workspaceRelativePath(file: string): string | undefined {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace || !isAbsolute(file)) return undefined;
  const rel = relative(resolve(workspace), resolve(file));
  if (rel === "" || isAbsolute(rel)) return undefined;
  const segments = rel.split(sep);
  // A leading ".." segment means the file escapes the workspace; a directory
  // merely named "..data" does not.
  if (segments[0] === "..") return undefined;
  return segments.join("/");
}

/**
 * Render a GitHub Actions annotation command line.
 *
 * Colors are stripped unconditionally: the runner renders the annotation as
 * text, and `FORCE_COLOR` keeps escapes alive even on a non-TTY stream.
 * @param level - Annotation severity
 * @param message - Annotation body
 * @param properties - Optional title and source location
 * @returns A single workflow command line, newline terminated
 */
export function formatAnnotation(
  level: AnnotationLevel,
  message: string,
  properties: AnnotationProperties = {},
): string {
  const entries: string[] = [];
  if (properties.title !== undefined) {
    entries.push(`title=${escapeProperty(stripVTControlCharacters(properties.title))}`);
  }
  if (properties.file !== undefined) {
    entries.push(`file=${escapeProperty(properties.file)}`);
  }
  if (properties.line !== undefined) {
    entries.push(`line=${properties.line}`);
  }
  const propertyList = entries.length > 0 ? ` ${entries.join(",")}` : "";
  return `::${level}${propertyList}::${escapeData(stripVTControlCharacters(message))}\n`;
}

function formattedMessage(error: Error): string | undefined {
  const format = (error as { format?: unknown }).format;
  if (typeof format !== "function") return undefined;
  const formatted: unknown = format.call(error);
  return typeof formatted === "string" ? formatted : undefined;
}

/**
 * Build the annotation body and title for a terminal CLI failure.
 *
 * Reuses the same text the CLI already prints so the annotation and the log
 * cannot drift: a `CLIError` renders through its own `format()`, which already
 * carries details, suggestion, help, and the next action.
 * @param error - Failure that ended the command
 * @param fallbackSuggestion - Suggestion shown for a plain error, when one exists
 * @returns Annotation body and optional title
 */
export function describeTerminalError(
  error: unknown,
  fallbackSuggestion?: string,
): { message: string; title?: string } {
  if (isCLIError(error)) {
    return { message: error.format(), title: error.code || "CLI_ERROR" };
  }
  if (error instanceof Error) {
    // Commands outside this package (the seed plugin's validate report) throw a
    // plain Error carrying its own `format()`, which holds the whole report.
    const title = getErrorDiagnostics(error).code ?? (error.name || "Error");
    const formatted = formattedMessage(error);
    if (formatted !== undefined) {
      return { message: formatted, title };
    }
    const suggestion = fallbackSuggestion ? `\nSuggestion: ${fallbackSuggestion}` : "";
    return { message: `${error.message}${suggestion}`, title };
  }
  return { message: `Unknown error: ${String(error)}`, title: "UNKNOWN_ERROR" };
}

/**
 * Attach the source location a failure points at.
 *
 * Consumed when the command's failure is annotated; the error is otherwise
 * unchanged, so its message and formatting stay the caller's own.
 * @param error - Failure to annotate
 * @param location - Absolute file, and the 1-based line when known
 * @returns The same error
 */
export function withSourceLocation<T extends Error>(error: T, location: ErrorSourceLocation): T {
  return withErrorDiagnostics(error, { location });
}

/**
 * Annotate the failure that ended the command, when running in GitHub Actions.
 * @param error - Failure that ended the command
 * @param options - JSON mode state and the suggestion shown for a plain error
 * @param options.jsonMode - Whether the CLI is producing a JSON document
 * @param options.suggestion - Suggestion shown for a plain error
 */
export function annotateTerminalError(
  error: unknown,
  options: { jsonMode: boolean; suggestion?: string },
): void {
  if (!annotationsEnabled(options.jsonMode)) return;
  const { message, title } = describeTerminalError(error, options.suggestion);
  process.stderr.write(formatAnnotation("error", message, { title, ...sourceLocation(error) }));
}

/**
 * Read an error's source location as annotation properties.
 *
 * A location outside the workspace is dropped rather than guessed at, so the
 * annotation still reports the failure without pointing at the wrong file.
 * @param error - Failure that ended the command
 * @returns `file`/`line` properties, or an empty object when unavailable
 */
function sourceLocation(error: unknown): { file?: string; line?: number } {
  if (!(error instanceof Error)) return {};
  const location = getErrorDiagnostics(error).location;
  if (!location) return {};
  const file = workspaceRelativePath(location.file);
  if (file === undefined) return {};
  return location.line === undefined ? { file } : { file, line: location.line };
}
