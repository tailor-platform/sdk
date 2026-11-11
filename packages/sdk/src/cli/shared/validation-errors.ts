import { isSyntaxDiagnostic } from "#/utils/syntax-diagnostic";
import { getErrorDiagnostics, withErrorDiagnostics } from "./error-diagnostics";
import { CLIError, internalError } from "./errors";
import { flattenZodIssues, formatIssueList, type FlatIssue } from "./zod-issues";
import type { AppConfig } from "#/configure/config/types";
import type { SdkBrandKind } from "#/utils/brand";
import type { z } from "zod";

interface ConfigServiceRef {
  /** `defineConfig` property the service is configured under. */
  configKey: keyof AppConfig;
  /** Service name, or the namespace for TailorDB. */
  name?: string;
}

interface ConfigErrorTarget {
  /** Config file that failed validation. */
  file: string;
  /** Config module export that failed validation. */
  exportName: "default" | "plugins";
  /** What failed, as it reads after "Invalid", such as `Tailor config`. */
  subject: string;
  /** The service that failed, when a single service config failed. */
  service?: ConfigServiceRef;
}

export interface ConfigInvalidErrorParams extends ConfigErrorTarget {
  /** Validation error of the failing value. */
  error: z.ZodError;
  /** Path of the failing value within `exportName`. */
  pathPrefix?: FlatIssue["path"];
}

export interface ConfigIssuesErrorParams extends ConfigErrorTarget {
  /** What is wrong, one entry per offending value, with paths within `exportName`. */
  issues: readonly FlatIssue[];
  /** Why the values are rejected. */
  details?: string;
  /** How to fix the values. */
  suggestion?: string;
  /** Failure the issues were derived from. */
  cause?: unknown;
}

/**
 * Create the error for a config file that failed schema validation.
 * @param params - Failed config and its validation error
 * @returns CLIError coded `CONFIG_INVALID`, located at the config file
 */
export function configInvalidError(params: ConfigInvalidErrorParams): CLIError {
  const { error, pathPrefix, ...target } = params;
  return configIssuesError({
    ...target,
    issues: flattenZodIssues(error.issues, pathPrefix),
    cause: error,
  });
}

/**
 * Create the error for a config file from issues the caller collected, such as values a check
 * other than its schema rejected.
 * @param params - Failed config and the issues found in it
 * @returns CLIError coded `CONFIG_INVALID`, located at the config file
 */
export function configIssuesError(params: ConfigIssuesErrorParams): CLIError {
  const { file, exportName, subject, service, issues, details, suggestion, cause } = params;
  return withErrorDiagnostics(
    CLIError({
      code: "CONFIG_INVALID",
      message: `Invalid ${subject}:\n${formatIssueList(issues)}`,
      details,
      suggestion,
      context: { file, exportName, ...service, issues },
      cause,
    }),
    { location: { file } },
  );
}

const DEFINITION_LABELS = {
  resolver: "resolver",
  executor: "executor",
  "tailordb-type": "TailorDB type",
  "http-adapter": "HTTP adapter",
  workflow: "workflow",
  "workflow-job": "workflow job",
} as const satisfies Partial<Record<SdkBrandKind, string>>;

export interface DefinitionErrorParams {
  /** Brand kind of the exported definition. */
  kind: keyof typeof DEFINITION_LABELS;
  /** Absolute path of the file that exports the definition. */
  file: string;
  /** Export the definition was found under. */
  exportName: string;
}

export interface DefinitionInvalidErrorParams extends DefinitionErrorParams {
  /** Validation error of the definition. */
  error: z.ZodError;
}

/**
 * Create the error for an SDK definition that failed validation.
 * @param params - Failed definition and its validation error
 * @returns CLIError coded `DEFINITION_INVALID`, located at the definition file
 */
export function definitionInvalidError(params: DefinitionInvalidErrorParams): CLIError {
  const { kind, file, exportName, error } = params;
  const issues = flattenZodIssues(error.issues);
  const exportLabel = exportName === "default" ? "" : ` \`${exportName}\``;
  return withErrorDiagnostics(
    CLIError({
      code: "DEFINITION_INVALID",
      message: `Invalid ${DEFINITION_LABELS[kind]}${exportLabel}:\n${formatIssueList(issues)}`,
      context: { kind, file, exportName, issues },
      cause: error,
    }),
    { location: { file } },
  );
}

/**
 * Create the error for an SDK definition exported where its loader does not read it.
 * @param params - Misplaced definition
 * @returns CLIError coded `DEFINITION_EXPORT_INVALID`, located at the definition file
 */
export function definitionExportError(params: DefinitionErrorParams): CLIError {
  const { kind, file, exportName } = params;
  const label = DEFINITION_LABELS[kind];
  const subject = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  const placement =
    exportName === "default"
      ? {
          message: `${subject} must not be the default export.`,
          suggestion: "Export it under a name instead.",
        }
      : {
          message: `${subject} must not be a named export, but it is exported as \`${exportName}\`.`,
          suggestion: "Export it only as the default export.",
        };
  return withErrorDiagnostics(
    CLIError({
      code: "DEFINITION_EXPORT_INVALID",
      ...placement,
      context: { kind, file, exportName },
    }),
    { location: { file } },
  );
}

/**
 * Create the error for a user module whose source does not parse.
 * @param thrown - Value thrown while importing the module
 * @returns CLIError coded `SYNTAX_INVALID`, located at the file and line the
 * source failed to parse on, or undefined when `thrown` is another failure
 */
export function syntaxInvalidError(thrown: unknown): CLIError | undefined {
  if (!isSyntaxDiagnostic(thrown)) return undefined;
  const { message, filename: file, startLine: line } = thrown;
  const location = line === undefined ? { file } : { file, line };
  return withErrorDiagnostics(
    CLIError({
      code: "SYNTAX_INVALID",
      message: `Invalid syntax: ${message}`,
      context: location,
      cause: thrown,
    }),
    { location },
  );
}

/**
 * Create the error for SDK- or Platform-produced data that failed validation,
 * which no user action can fix.
 * @param subject - What failed, as it reads after "Invalid", such as `workspace context`
 * @param error - Validation error of the data
 * @returns Plain Error, reported as `UNEXPECTED_ERROR`
 */
export function invalidDataError(subject: string, error: z.ZodError): Error {
  return internalError(`Invalid ${subject}:\n${formatIssueList(flattenZodIssues(error.issues))}`, {
    cause: error,
  });
}

/**
 * Attribute a failure raised while loading a user module to the module's file.
 *
 * A failure that already carries a source location, such as a syntax error in a
 * module the file imports, keeps it.
 * @param error - Value thrown while loading the module
 * @param file - Absolute path of the module
 * @returns The same value, located at `file` when it is an Error without a location
 */
export function atUserModule(error: unknown, file: string): unknown {
  if (!(error instanceof Error) || getErrorDiagnostics(error).location) return error;
  return withErrorDiagnostics(error, { location: { file } });
}
