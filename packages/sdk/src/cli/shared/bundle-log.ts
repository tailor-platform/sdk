import { CLIError } from "#/cli/shared/errors";
import type * as rolldown from "rolldown";

// rolldown externalizes an import it cannot resolve and reports it as a
// warning, so a bundle that still contains the bare specifier would otherwise
// deploy as a success and only fail once the platform runs it. `logLevel`
// cannot stay `"silent"` here: rolldown's level gate drops warnings before
// `onLog` is ever consulted, so the escalation only sees the log at `"warn"`.
// Every other log stays suppressed by never delegating to `defaultHandler`.
const ESCALATED_LOG_CODE = "UNRESOLVED_IMPORT";

// Bundler entries import `@tailor-platform` packages for modules the platform
// runtime supplies — `@tailor-platform/sdk/kysely` and the
// `@tailor-platform/function-kysely-tailordb` it re-exports. Those legitimately
// stay unresolved whenever the bundle is built where they are not installed: an
// unbuilt checkout, or a global CLI invocation. They must never fail the build.
//
// Discriminating on the specifier rather than on the importing file covers every
// entry kind: some bundlers inline their entry as a rolldown virtual module,
// others write a physical `.entry` file, and hooks/validators copy the user's
// own imports into the entry alongside the injected ones.
const PLATFORM_SCOPE = "@tailor-platform/";

function isPlatformSuppliedImport(log: rolldown.RollupLog): boolean {
  return log.exporter?.startsWith(PLATFORM_SCOPE) ?? false;
}

export interface BundleLogOptions {
  /** Absolute path of the tsconfig handed to rolldown, when one was resolved. */
  tsconfig?: string;
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
      if (log.code !== ESCALATED_LOG_CODE || isPlatformSuppliedImport(log)) return;
      throw unresolvedImportError(log, options.tsconfig);
    },
  };
}

// rolldown surfaces only `message` when an `onLog` handler throws, so the
// tsconfig context and the fix have to live in the message itself rather than
// in CLIError's `details`/`suggestion` fields.
function unresolvedImportError(log: rolldown.RollupLog, tsconfig: string | undefined): Error {
  const specifier = log.exporter ?? "an imported module";
  // A virtual entry's id carries a leading `\0`, which renders as a stray
  // control character; name the bundler's generated entry instead.
  const importerId = log.id?.startsWith("\0")
    ? `a generated entry (${log.id.slice(1)})`
    : log.id && `"${log.id}"`;
  const importer = importerId ? ` imported from ${importerId}` : "";
  // The tsconfig named here is the build-level one. A `paths` alias is resolved
  // against the importing file's own nearest tsconfig that declares `paths`,
  // which may be an ancestor of this one, so the wording stays non-committal.
  const context = tsconfig
    ? `Check that the import path is correct, and that a \`compilerOptions.paths\` entry covering it is declared in the importing file's own tsconfig.json or an ancestor. The build used "${tsconfig}".`
    : "No tsconfig.json was found, so `compilerOptions.paths` aliases were not applied. Add a tsconfig.json declaring the aliases this file imports.";
  return CLIError({
    code: "UNRESOLVED_IMPORT",
    message: `Could not resolve "${specifier}"${importer}. ${context}`,
  });
}
