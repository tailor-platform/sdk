import { CLIError } from "#/cli/shared/errors";
import type * as rolldown from "rolldown";

// rolldown externalizes an import it cannot resolve and reports it as a
// warning, so a bundle that still contains the bare specifier would otherwise
// deploy as a success and only fail once the platform runs it. `logLevel`
// cannot stay `"silent"` here: rolldown's level gate drops warnings before
// `onLog` is ever consulted, so the escalation only sees the log at `"warn"`.
// Every other log stays suppressed by never delegating to `defaultHandler`.
const ESCALATED_LOG_CODE = "UNRESOLVED_IMPORT";

// Bundler entries inject `@tailor-platform/sdk` imports the platform runtime
// supplies, and those are expected to stay unresolved when the bundle is built
// outside a project that has the SDK installed. Only an import written in a
// user file can indicate the broken bundle this escalation guards against.
// Virtual modules carry rolldown's `\0` prefix on the resolved id.
const VIRTUAL_MODULE_PREFIX = "\0";

function isUserImport(log: rolldown.RollupLog, options: BundleLogOptions): boolean {
  const importer = log.id;
  if (importer === undefined) return false;
  if (!importer.startsWith(VIRTUAL_MODULE_PREFIX)) return true;
  // An entry that inlines user code carries the user's own imports, so an
  // unresolved one there is a real defect rather than an injected module.
  return options.virtualEntrySourceFile !== undefined;
}

export interface BundleLogOptions {
  /** Absolute path of the tsconfig handed to rolldown, when one was resolved. */
  tsconfig?: string;
  /**
   * Source file a bundler's virtual entry was built from. Set it when the entry
   * inlines user code, so an unresolved import the user wrote still fails the
   * build instead of being treated as an SDK-injected platform module.
   */
  virtualEntrySourceFile?: string;
}

export interface BundleLogRolldownOptions {
  logLevel: "warn";
  onLog: NonNullable<rolldown.InputOptions["onLog"]>;
}

/**
 * Build the rolldown log options that turn an unresolved import into a build
 * failure while keeping every other rolldown log suppressed.
 * @param options - Context used to explain which tsconfig was in effect
 * @returns rolldown `logLevel`/`onLog` options to spread into the build config
 */
export function createBundleLogOptions(options: BundleLogOptions = {}): BundleLogRolldownOptions {
  return {
    logLevel: "warn",
    onLog: (_level, log) => {
      if (log.code !== ESCALATED_LOG_CODE || !isUserImport(log, options)) return;
      throw unresolvedImportError(log, options.tsconfig);
    },
  };
}

// rolldown surfaces only `message` when an `onLog` handler throws, so the
// tsconfig context and the fix have to live in the message itself rather than
// in CLIError's `details`/`suggestion` fields.
function unresolvedImportError(log: rolldown.RollupLog, tsconfig: string | undefined): Error {
  const specifier = log.exporter ?? "an imported module";
  const importer = log.id ? ` imported from "${log.id}"` : "";
  const context = tsconfig
    ? `Path aliases were resolved against "${tsconfig}". Check that the import path is correct and that this tsconfig declares a matching \`compilerOptions.paths\` entry — a tsconfig.json nearer to the importing file shadows the aliases declared in the project root.`
    : "No tsconfig.json was found, so `compilerOptions.paths` aliases were not applied. Add a tsconfig.json declaring the aliases this file imports.";
  return CLIError({
    code: "UNRESOLVED_IMPORT",
    message: `Could not resolve "${specifier}"${importer}. ${context}`,
  });
}
