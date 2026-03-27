import * as fs from "node:fs";
import { transformFile } from "./codemod-engine";
import type { FileDiff, MigrationRule, TransformResult } from "./types";

/**
 * A migration rule created by `createRule`, with the source-level transform
 * function exposed for direct use in tests.
 */
export interface SourceRule extends MigrationRule {
  /** The source-level transform function (exposed for fixture tests). */
  transformSource: (source: string) => string | null;
}

/** Scan function for warning-only rules. */
export type WarningScanFn = (source: string, file: string) => string | string[] | null;

/**
 * A warning-only migration rule with the scan function exposed for testing.
 */
export interface WarningRule extends MigrationRule {
  /** The scan function that produces warnings (exposed for direct testing). */
  scanSource: WarningScanFn;
}

/**
 * Create a migration rule with reduced boilerplate.
 *
 * Handles the file iteration loop, `transformFile` calls, diff collection,
 * and result aggregation. The caller only provides the metadata and a
 * source-level transform function.
 *
 * The returned rule exposes `transformSource` so tests can call it directly
 * without duplicating the transform logic.
 * @param meta - Rule metadata (id, name, description, since, until)
 * @param transformSource - Function that transforms a single file's source code.
 *   Return the new source string if changes were made, or `null` if no changes.
 * @returns A SourceRule with the transform function and exposed transformSource
 * @public
 */
export function createRule(
  meta: Omit<MigrationRule, "transform">,
  transformSource: (source: string) => string | null,
): SourceRule {
  return {
    ...meta,
    transformSource,
    async transform(ctx): Promise<TransformResult> {
      const filesModified: string[] = [];
      const diffs: FileDiff[] = [];

      for (const file of ctx.files) {
        const result = await transformFile(file, transformSource, ctx.dryRun);
        if (result.changed) {
          filesModified.push(file);
          if (result.before !== undefined && result.after !== undefined) {
            diffs.push({ file, before: result.before, after: result.after });
          }
        }
      }

      return {
        changed: filesModified.length > 0,
        filesModified,
        warnings: [],
        diffs: diffs.length > 0 ? diffs : undefined,
      };
    },
  };
}

/**
 * Create a warning-only migration rule that scans files without modifying them.
 *
 * Iterates over each file in the context, reads its content, and calls the
 * scan function to collect warnings. Files are never written to. This is
 * useful for detecting patterns that require manual intervention.
 *
 * The returned rule exposes `scanSource` so tests can call it directly.
 * @param meta - Rule metadata (id, name, description, since, until)
 * @param scanSource - Function that scans a single file's source code.
 *   Return a warning string, an array of warning strings, or `null` if
 *   no warnings are found.
 * @returns A WarningRule with the transform function and exposed scanSource
 * @public
 */
export function createWarningRule(
  meta: Omit<MigrationRule, "transform">,
  scanSource: WarningScanFn,
): WarningRule {
  return {
    ...meta,
    scanSource,
    async transform(ctx): Promise<TransformResult> {
      const warnings: string[] = [];

      for (const file of ctx.files) {
        const source = await fs.promises.readFile(file, "utf-8");
        const result = scanSource(source, file);
        if (result !== null) {
          if (Array.isArray(result)) {
            warnings.push(...result);
          } else {
            warnings.push(result);
          }
        }
      }

      return {
        changed: false,
        filesModified: [],
        warnings,
        diffs: undefined,
      };
    },
  };
}
