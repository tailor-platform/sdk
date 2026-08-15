import * as v from "valibot";

/**
 * Formats Valibot issues into multi-line, field-path-annotated text.
 * @param issues - The issues from a failed parse (`v.safeParse(...).issues` or `ValiError#issues`)
 * @returns One `path: message` line per issue; path-less issues contribute the message alone
 */
export function formatValiIssuePaths(
  issues: readonly [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]],
): string {
  const flat = v.flatten(issues);
  const lines: string[] = [...(flat.root ?? [])];
  for (const [fieldPath, messages] of Object.entries(flat.nested ?? {})) {
    for (const message of messages ?? []) {
      lines.push(`${fieldPath}: ${message}`);
    }
  }
  return lines.join("\n");
}
