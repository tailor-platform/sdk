import type { AppConfig } from "#/configure/config/types";
import type { EffectiveDateDefault } from "#/runtime/date";

const DATE_DEFAULT_GATE = "__TAILOR_PLATFORM_BUNDLE_DATE_DEFAULT";

/**
 * Expose the date default to `t` date fields in this worker, the way the
 * define plugin folds it into deployed bundles.
 * @param dateDefault - The representation `t` date fields without `as` follow
 * @returns A function that restores the previous value
 */
export function applyDateDefault(dateDefault: EffectiveDateDefault): () => void {
  const previous = process.env[DATE_DEFAULT_GATE];
  if (dateDefault === "temporal") {
    process.env[DATE_DEFAULT_GATE] = dateDefault;
  } else {
    delete process.env[DATE_DEFAULT_GATE];
  }
  return () => {
    if (previous === undefined) delete process.env[DATE_DEFAULT_GATE];
    else process.env[DATE_DEFAULT_GATE] = previous;
  };
}

/**
 * Give `t.date()`, `t.datetime()`, and `t.time()` fields that omit `as` the
 * given representation for the rest of this test worker, as if the code under
 * test were bundled under that `defaultDateRepresentation`. Generated migration
 * tests call it with the representation recorded in the migration's `diff.json`,
 * so a later change to `tailor.config.ts` does not alter what the test exercises.
 * @param representation - The `defaultDateRepresentation` value to apply
 * @returns A function that restores the previous representation
 */
export function applyDateRepresentation(
  representation: NonNullable<AppConfig["defaultDateRepresentation"]>,
): () => void {
  return applyDateDefault(representation);
}
