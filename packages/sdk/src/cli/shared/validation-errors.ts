import * as path from "pathe";
import { withErrorDiagnostics } from "./error-diagnostics";
import { CLIError, internalError } from "./errors";
import { flattenZodIssues, formatIssueList, type FlatIssue } from "./zod-issues";
import type { SdkBrandKind } from "#/utils/brand";
import type { z } from "zod";

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
  return withErrorDiagnostics(
    CLIError({
      code: "DEFINITION_EXPORT_INVALID",
      message:
        exportName === "default"
          ? `${subject} must be a named export, but it is the default export.`
          : `${subject} must be the default export, but it is exported as \`${exportName}\`.`,
      suggestion:
        exportName === "default"
          ? "Export it under a name, such as `export const myJob = ...`."
          : `Export it as the default export: \`export default ${exportName}\`.`,
      context: { kind, file, exportName },
    }),
    { location: { file } },
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

function relativeFile(file: string): string {
  return path.relative(process.cwd(), file);
}

export interface ConfigInvalidErrorParams {
  /** Config file that failed validation. */
  file: string;
  /** Config module export that failed validation. */
  exportName: "default" | "plugins";
  /** What failed, as it reads after "Invalid", such as `Tailor config`. */
  subject: string;
  /** Flattened issues, with paths from the root of `exportName`. */
  issues: FlatIssue[];
  /** `defineConfig` property and service name, when a single service failed. */
  service?: { configKey: string; name?: string };
  /** Validation error the issues came from. */
  cause: unknown;
}

/**
 * Create the error for a config file that failed validation.
 * @param params - Failed config and its issues
 * @returns CLIError coded `CONFIG_INVALID`, located at the config file
 */
export function configInvalidError(params: ConfigInvalidErrorParams): CLIError {
  const { file, exportName, subject, issues, service, cause } = params;
  return withErrorDiagnostics(
    CLIError({
      code: "CONFIG_INVALID",
      message: `Invalid ${subject} in ${file}:\n${formatIssueList(issues)}`,
      context: { file, exportName, ...service, issues },
      cause,
    }),
    { location: { file } },
  );
}
