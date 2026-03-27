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
