import { escapeRegExp } from "es-toolkit";
import * as path from "pathe";
import { isSyntaxDiagnostic } from "#/utils/syntax-diagnostic";
import { getErrorDiagnostics, withErrorDiagnostics } from "./error-diagnostics";
import { CLIError, internalError, isCLIError } from "./errors";
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

export interface ConfigInvalidErrorParams {
  /** Config file that failed validation. */
  file: string;
  /** Config module export that failed validation. */
  exportName: "default" | "plugins";
  /** What failed, as it reads after "Invalid", such as `Tailor config`. */
  subject: string;
  /** Validation error of the failing value. */
  error: z.ZodError;
  /** Path of the failing value within `exportName`. */
  pathPrefix?: FlatIssue["path"];
  /** The service that failed, when a single service config failed. */
  service?: ConfigServiceRef;
}

/**
 * Create the error for a config file that failed validation.
 * @param params - Failed config and its validation error
 * @returns CLIError coded `CONFIG_INVALID`, located at the config file
 */
export function configInvalidError(params: ConfigInvalidErrorParams): CLIError {
  const { file, exportName, subject, error, pathPrefix, service } = params;
  const issues = flattenZodIssues(error.issues, pathPrefix);
  return withErrorDiagnostics(
    CLIError({
      code: "CONFIG_INVALID",
      message: `Invalid ${subject} in ${relativeFile(file)}:\n${formatIssueList(issues)}`,
      context: { file, exportName, ...service, issues },
      cause: error,
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
      message: `Invalid ${DEFINITION_LABELS[kind]}${exportLabel} in ${relativeFile(file)}:\n${formatIssueList(issues)}`,
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
  const subject = `${label.charAt(0).toUpperCase()}${label.slice(1)} in ${relativeFile(file)}`;
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
  const lineSuffix = line === undefined ? "" : `:${line}`;
  return withErrorDiagnostics(
    CLIError({
      code: "SYNTAX_INVALID",
      message: `Invalid syntax in ${relativeFile(file)}${lineSuffix}: ${message}`,
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
 * Prefix a failure raised while loading a user module with the module's file.
 *
 * A failure that already names its source, by its location or in its message,
 * is returned as-is. Any other error is copied with the file before its
 * message, keeping its class, stack, cause, diagnostics, and other fields. An
 * error whose class defines getters, which may read state the copy lacks, is
 * instead rebuilt as an Error with its name and the original as its cause.
 * @param error - Value thrown while loading the module
 * @param file - Absolute path of the module
 * @returns The failure, naming the file when it is an Error that does not
 * already name its source
 */
export function prefixUserModuleFile(error: unknown, file: string): unknown {
  if (!(error instanceof Error)) return error;
  const diagnostics = getErrorDiagnostics(error);
  const relativePath = relativeFile(file);
  if (
    diagnostics.location ||
    namesPath(error.message, file) ||
    namesPath(error.message, relativePath)
  ) {
    return error;
  }
  return withErrorDiagnostics(withMessage(error, `${relativePath}: ${error.message}`), diagnostics);
}

function namesPath(message: string, filePath: string): boolean {
  return new RegExp(`${escapeRegExp(filePath)}(?![\\w-]|\\.[\\w-])`).test(message);
}

function withMessage(error: Error, message: string): Error {
  const stack = { value: error.stack, writable: true, configurable: true };
  if (isCLIError(error)) {
    const copy = CLIError({
      code: error.code,
      message,
      details: error.details,
      suggestion: error.suggestion,
      command: error.command,
      next: error.next,
      context: error.context,
      cause: error.cause,
    });
    return Object.defineProperty(copy, "stack", stack);
  }
  const prototype: object | null = Object.getPrototypeOf(error);
  if (definesGetters(prototype)) {
    const rebuilt = new Error(message, { cause: error });
    rebuilt.name = error.name;
    return Object.defineProperty(rebuilt, "stack", stack);
  }
  const copy: Error = Object.setPrototypeOf(new Error(), prototype);
  return Object.defineProperties(copy, {
    ...Object.getOwnPropertyDescriptors(error),
    message: { value: message, writable: true, configurable: true },
    stack,
  });
}

function definesGetters(prototype: object | null): boolean {
  for (
    let current: object | null = prototype;
    current && current !== Error.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    const descriptors = Object.values(Object.getOwnPropertyDescriptors(current));
    if (descriptors.some((descriptor) => descriptor.get)) return true;
  }
  return false;
}

function relativeFile(file: string): string {
  return path.relative(process.cwd(), file);
}
