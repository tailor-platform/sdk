import * as fs from "node:fs";
import * as path from "pathe";
import { withErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { CLIError, isCLIError } from "#/cli/shared/errors";
import { analyzeSql } from "#/utils/sql/analyze";
import { renderSqlModule } from "#/utils/sql/render";
import type { SqlDiagnostic } from "#/utils/sql/parser";
import type { SqlContextLoader } from "./definitions";
import type * as rolldown from "rolldown";

const PLUGIN_NAME = "tailor-sql";

function position(source: string, offset: number): { line: number; column: number } {
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length, column: (lines.at(-1) ?? "").length + 1 };
}

function sqlInvalidError(file: string, source: string, diagnostics: SqlDiagnostic[]): CLIError {
  const located = diagnostics.map((diagnostic) => ({
    ...position(source, diagnostic.start),
    message: diagnostic.message,
  }));
  const name = path.relative(process.cwd(), file);
  return withErrorDiagnostics(
    CLIError({
      code: "SQL_INVALID",
      message: located.map((d) => `${name}:${d.line}:${d.column}: ${d.message}`).join("\n"),
      context: { file, diagnostics: located },
    }),
    { location: { file, line: located[0]?.line } },
  );
}

/**
 * Find the error a `.sql` import raised inside the error rolldown wraps plugin failures in.
 * @param error - Error a rolldown build rejected with
 * @returns The `.sql` import's error, or undefined when the build failed for another reason
 */
export function sqlErrorOf(error: unknown): CLIError | undefined {
  const errors = (error as { errors?: unknown } | undefined)?.errors;
  if (!Array.isArray(errors) || errors.length !== 1) return undefined;
  const [inner] = errors as unknown[];
  if (!isCLIError(inner)) return undefined;
  // rolldown replaces a plugin error's `code` with `PLUGIN_ERROR` and keeps the original as `pluginCode`.
  const { plugin, pluginCode } = inner as { plugin?: unknown; pluginCode?: unknown };
  if (plugin !== PLUGIN_NAME || typeof pluginCode !== "string") return undefined;
  return Object.assign(inner, { code: pluginCode });
}

/**
 * Create the plugin that bundles each imported `.sql` file as a query checked
 * against the TailorDB definitions.
 * @param loadContext - Provides the definitions, or undefined where `.sql` imports are not supported
 * @param trackDependency - Records a file the bundle depends on, for the bundle cache
 * @returns The rolldown plugin
 */
export function createSqlBundlePlugin(
  loadContext: SqlContextLoader | undefined,
  trackDependency?: (file: string) => void,
): rolldown.Plugin {
  return {
    name: PLUGIN_NAME,
    load: {
      filter: { id: /\.sql$/ },
      async handler(id) {
        if (!loadContext) {
          throw CLIError({
            code: "SQL_UNSUPPORTED",
            message: `${path.relative(process.cwd(), id)} cannot be imported here`,
            suggestion:
              "Import .sql files from resolvers, executors, workflow jobs and auth hooks, or from a file run with `tailor function run`.",
          });
        }
        const context = await loadContext();
        for (const dependency of context.dependencies) trackDependency?.(dependency);
        const source = fs.readFileSync(id, "utf8");
        const { analysis, diagnostics } = analyzeSql(source, context.definitions);
        if (!analysis) throw sqlInvalidError(id, source, diagnostics);
        return { code: renderSqlModule(analysis), moduleType: "js" };
      },
    },
  };
}
